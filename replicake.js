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

exports.mk_node = function(node_name, data_dir, conf, storage, comm) {
  var time_start = new Date();
  var log_db     = null;

  console.info('replicake node...')
  console.info('  time-start = ' + time_start.toJSON());
  console.info('  node-name  = ' + node_name);
  console.info('  data-dir   = ' + data_dir);

  var node_state = { curr: 'start' }; // A replicake node has a state machine.

  on_transition(node_state, 'start', 'opening',
                function() {
                  storage.open(data_dir, node_name, conf.get('log_db'),
                               function(err, log_db_in) {
                                 if (!err) {
                                   assert(!log_db, 'log_db should be null');
                                   log_db = log_db_in;
                                   go(node_state, 'running');
                                 } else {
                                   assert(false, "TODO: storage open error handling");
                                 }
                               });
                });

  on_transition(node_state, 'opening', 'running',
                function() {
                  log_db.get('open_rosters', function(_key, roster_ids) {
                      for (var roster_id in roster_ids) {
                        mk_roster_member(roster_id).open();
                      }
                    });

                  // Concurrently...
                  // -- handle roster changes.
                  // -- handle initial/seed roster.
                  // -- dispatch requests to the right roster.
                });

  on_transition(node_state, 'running', 'closing',
                function() {
                  log_db.save(function() {
                      log_db.close();
                      log_db = null;
                      go(node_state, 'end');
                    });
                });

  on_transition(node_state, 'closing', 'end', function() { assert(!log_db); });

  // A roster_member object represents the participation of this node
  // in a given roster (or roster_id).  This node can participate in
  // multiple rosters at the same time; hence, we have a map that
  // tracks the multiple roster_member objects per node.
  //
  var roster_member_map = {}; // Key = roster_id; value = roster_member object.
  var max_defunct_roster_member_id = null;

  function mk_roster_member(roster_id) {
    assert(roster_member_map[roster_id] == null);

    var data = { start_slot_id: null,
                 members: null };

    // A roster_member has a state machine.
    var roster_member_state = { curr: 'start' };
    var finished_bcast = null;

    var leader_name = null;
    var leader_lease = null;

    on_transition(roster_member_state, 'start', 'creating',
                  function() {
                    assert(data.start_slot_id != null && data.members != null);
                    storage.create(roster_id, data,
                                   function(err) {
                                     if (!err) {
                                       go(roster_member_state, 'opening');
                                     } else {
                                       assert(false, "TODO");
                                     }
                                   });
                  });

    on_transition(roster_member_state, 'start',    'opening', open_roster_member);
    on_transition(roster_member_state, 'creating', 'opening', open_roster_member);
    
    function open_roster_member() {
      storage.open(roster_id,
                   function(err, in_data) {
                     if (!err && in_data) {
                       assert(data.start_slot_id == null && data.members == null);
                       data = in_data;
                       assert(data.start_slot_id != null && data.members != null);
                       go(roster_member_state, 'running');
                     } else {
                       assert(false, "TODO");
                     }
                   });
    }

    on_transition(roster_member_state, 'opening', 'running',
                  function() {
                    elect_leader();
                    catch_up_log_holes();

                    // Concurrently...
                    // -- find and/or help choose leader
                    // -- participate in paxos for log slots
                    // -- continually catchup on log holes
                    // -- help others catchup on log holes
                    // -- apply fully received log entries
                    // -- take local snapshots
                    // -- garbage collect old log entries
                    // -- handle roster changes
                  });

    function elect_leader() {
      if (roster_member_state == 'running') {
        if (leader_name == null ||
            is_expired(leader_lease)) {
          bcast('leader_elect', suggested_leader());
        }
        periodically(elect_leader);
      }
    }

    function catch_up_log_holes() {
      if (roster_member_state == 'running') {
        periodically(catch_up_log_holes);
      }
    }

    on_transition(roster_member_state, 'running', 'finishing', // Last entry executed.
                  function() {
                    assert(!finished_bcast);
                    finished_cast = bcast_periodically('finished');
                  });
    on_transition(roster_member_state, 'finishing', 'defunct',
                  function() {
                    assert(finished_bcast);
                    finished_bcast.stop();
                    finished_bcast = null;
                  });

    var roster_member = roster_member_map[roster_id] = {
      'open':  function() {
        go(roster_member_state, 'opening')
        return roster_member;
      },
      'create': function(in_start_slot_id, in_members) {
        assert(data.start_slot_id == null && data.members == null);
        data.start_slot_id = in_start_slot_id;
        data.members = in_members;
        go(roster_member_state, 'creating');
        return roster_member;
      },
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

  running_event('roster_join', function(in_roster_id, in_start_slot_id, in_members) {
      if (in_roster_id > max_defunct_roster_member_id) {
        return mk_roster_member(in_roster_id).create(in_start_slot_id, in_members);
      }
    });

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

  function todo() {};

  var self = {
    'go': function(to_state) { go(node_state, to_state); return self; },
    'open': function() { self.go("opening"); return self; }
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

