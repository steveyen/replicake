// Given a set of nodes...
//
// - Overlapping subsets of the nodes participate in 1 or more 'rosters'.
// - We create new rosters sequentially over time whenever we add/remove nodes.
// - A newly created roster eventually takes over from the previous roster.
//
// 'cluster' ------------------------------------< node
// 'cluster' ---< 'roster' ---< roster_member >--- node
//
var assert = require('assert');

exports.open_node = function(node_name, data_dir, conf, storage, comm) {
  var time_start = new Date();
  var log_db     = null;

  console.info('replicake node...')
  console.info('  time-start = ' + time_start.toJSON());
  console.info('  node-name  = ' + node_name);
  console.info('  data-dir   = ' + data_dir);

  var node_state = { curr: 'opening' }; // A replicake node has a state machine.

  on_transition(node_state, 'opening', 'warming',
                function() {
                  storage.open(data_dir, node_name, conf.get('log_db'),
                               function(err, log_db_in) {
                                 assert(log_db == null,
                                        'log_db should be null');
                                 log_db = log_db_in;
                                 go(node_state, 'running');
                               });
                });

  on_transition(node_state, 'warming', 'running',
                function() {
                  assert(log_db);

                  broadcast();

                  // Concurrently...
                  // -- find and/or help choose leader
                  // -- start paxos participation / log replica
                  // -- continually catchup on log holes
                  // -- help others catchup on log holes
                  // -- apply fully received log entries
                  // -- take local snapshots
                  // -- garbage collect old log entries
                  // -- handle roster changes
                });


  on_transition(node_state, 'running', 'paused', function() { assert(log_db); });
  on_transition(node_state, 'paused', 'running', function() { assert(log_db); });

  on_transition(node_state, 'running', 'cooling', cool);
  on_transition(node_state, 'warming', 'cooling', cool);
  on_transition(node_state, 'cooling', 'closed', function() { assert(!log_db); });

  function cool() {
    assert(log_db);
    log_db.save(function() {
        log_db.close();
        log_db = null;
        go(node_state, 'closed');
      });
  }

  // A roster_member object represents the participation of this node
  // in a given roster (or roster_id).  This node can participate in
  // multiple rosters at the same time; hence, we can have multiple
  // roster_member objects per node.
  //
  var roster_member_map = {}; // Keys = roster_id; values = roster_member objects.
  var max_defunct_roster_member_id = null;

  function load_roster_member(roster_id) {
    return mk_roster_member(roster_id, null).load();
  }
  function start_roster_member(roster_id, start_slot_id) {
    return mk_roster_member(roster_id, start_slot_id).start();
  }

  function mk_roster_member(roster_id, start_slot_id) {
    assert(roster_member_map[roster_id] == null);

    // A roster_member has a state machine.
    var roster_member_state = { curr: 'start' };
    var finished_bcast = null;

    on_transition(roster_member_state, 'start', 'warming',
                  function() {
                    need_starting_state(roster_id);
                  });
    on_transition(roster_member_state, 'warming', 'finished',
                  function() {
                    if (last_checkpoint_slot_id(storage, roster_id) >= start_slot_id) {
                      go(roster_member_state, 'running');
                    } else {
                      need_starting_state(roster_id);
                    }
                  });
    on_transition(roster_member_state, 'warming', 'running', todo);
    on_transition(roster_member_state, 'running', 'cooling', todo);
    on_transition(roster_member_state, 'cooling', 'last_entry_executed',
                  function () {
                    go(roster_member_state, 'finished');
                  });
    on_transition(roster_member_state, 'last_entry_executed', 'finished',
                  function () {
                    assert(finished_bcast == null);
                    finished_cast = bcast_periodically('finished');
                  });
    on_transition(roster_member_state, 'finished', 'defunct',
                  function () {
                    assert(finished_bcast);
                    finished_bcast.stop();
                    finished_bcast = null;
                  });

    var roster_member = roster_member_map[roster_id] = {
      'load':  function() { go(roster_member_state, 'warming'); return roster_member; },
      'start': function() { go(roster_member_state, 'warming'); return roster_member; },
      'on_slot_action': function(action, slot, req, res) {
      }
    }
    return roster_member;
  }

  var paxos_proposer = null;
  var paxos_acceptor = null;
  var paxos_learner = null;

  comm_register_roster_slot('promise_req');
  comm_register_roster_slot('promise_res');
  comm_register_roster_slot('accept_req');
  comm_register_roster_slot('accept_res');

  function comm_register_roster_slot(action) {
    comm.post('/roster/:roster/slots/:slot/' + action,
              function(req, res) {
                var r_id = req.param(":roster");
                var s_id = req.param(":slot");
                if (r_id && s_id) {
                  if (r_id <= max_defunct_roster_member_id) {
                    // TODO: redirect new_configuration(current_roster_member_id);
                    return;
                  }
                  var roster = roster_member_map[r_id];
                  if (roster) {
                    roster.on_slot_action(action, slot, req, res);
                  }
                }
              });
  }

  running_event('leader_ping_req', leader_ping_req);
  running_event('leader_ping_res', leader_ping_res);
  running_event('leader_ping_timeout', leader_ping_timeout);

  running_event('catchup_req', catchup_req);
  running_event('catchup_res', catchup_res);
  running_event('catchup_timeout', catchup_timeout);

  running_event('election_start', todo);
  running_event('election_announce', todo);

  running_event('log_entry_learned', todo);
  running_event('log_gc_timeout', todo);

  running_event('new_roster', todo);

  running_event('snapshot_timeout', todo);

  running_event('roster_join', todo);
  running_event('roster_join_request', todo);
  running_event('roster_finished', todo);
  running_event('roster_defunct', todo);
  running_event('roster_created', todo);

  function running_event(name, cb) {
    on_transition(node_state, 'running', ['running', name], cb);
  }

  function leader_ping_req() {};
  function leader_ping_res() {};
  function leader_ping_timeout() {};

  function catchup_req() {};
  function catchup_res() {};
  function catchup_timeout() {};

  function broadcast() {};

  function todo() {};

  var self = {
    'go': function(to_state) { go(node_state, to_state); return self; },
    'warm': function() { self.go("warming"); return self; }
  };

  return self;
};

// State machine helpers.

function on_transition(state, from_state, to_state, cb) {
  state.transitions = state.transitions || {};
  var to_state_name = typeof(to_state) == "string" ? to_state : to_state[1];
  var to_state_actual = typeof(to_state) == "string" ? to_state : to_state[0];
  assert(state.transitions[from_state + ' => ' + to_state_name] == null);
  state.transitions[from_state + ' => ' + to_state_name] = [cb, to_state_actual];
}

function go(state, to_state, arg0, arg1) {
  state.hist = state.hist || [];
  assert(state.curr);
  var transition = state.curr + ' => ' + to_state;
  console.info('transition: ' + transition);
  assert(state.transitions[transition]);
  state.hist[state.hist.length] = (new Date().toJSON()) + ': ' + transition;
  state.curr = state.transitions[transition][1] || to_state;
  state.transitions[transition][0](arg0, arg1);
}

