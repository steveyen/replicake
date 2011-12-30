// Given a set of nodes...
// - subsets of those nodes participate in 1 or more immutable 'rosters'.
// - new rosters are created sequentially over time as nodes are added/removed.
// - multiple rosters, however, might be running concurrently
//   and may overlap in their usage of nodes, as newer rosters
//   take over from older rosters.
// - on each participating node, for each roster, there's a roster_member object.
// - a roster_member might be started or running or finished or defunct
//   w.r.t. its roster.
//
// cluster ----------------------------------< node
// cluster ---< roster ---< roster_member >--- node
//
var assert = require('assert');

exports.open_node = function(conf, log_db_module, routes) {
  var log_db = null;

  var time_start = new Date();
  var node_name  = conf.get('node_name');
  var data_dir   = conf.get('data_dir');

  console.info('replicake...')
  console.info('  time_start = ' + time_start.toJSON());
  console.info('  node_name  = ' + node_name);
  console.info('  data_dir   = ' + data_dir);

  if (node_name == null || node_name.toString().length <= 0) {
    console.error("ERROR: missing node_name for replicake node.");
    return null;
  }

  // Each node has a state machine.
  var node_state = { curr: 'opening' };

  on_transition(node_state, 'opening', 'warming',
                function() {
                  log_db_module.log_db_open(data_dir, node_name, conf.get('log_db'),
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

  on_transition(node_state, 'running', 'cooling', cool);
  on_transition(node_state, 'warming', 'cooling', cool);
  on_transition(node_state, 'cooling', 'closed', function() { assert(log_db == null); });

  function cool() {
    assert(log_db);
    log_db.save(function() {
        log_db.close();
        log_db = null;
        go(node_state, 'closed');
      });
  }

  var roster_member_map = {}; // Keys are roster_id; values are roster_member objects.
  var max_defunct_roster_member_id = null;

  function load_roster_member(roster_id) {
    return mk_roster_member(roster_id, null).load();
  }
  function start_roster_member(roster_id, prev_roster_id) {
    return mk_roster_member(roster_id, prev_roster_id).start();
  }

  function mk_roster_member(roster_id, prev_roster_id) {
    assert(roster_member_map[roster_id] == null);

    // Each roster_member has its own state machine.
    var roster_member_state = { curr: 'start' };

    on_transition(roster_member_state, 'start',   'warming', todo);
    on_transition(roster_member_state, 'warming', 'running', todo);
    on_transition(roster_member_state, 'running', 'cooling', todo);
    on_transition(roster_member_state, 'cooling', 'end', todo);

    var roster_member = roster_member_map[roster_id] = {
      'load':  function() { go(roster_member_state, 'warming'); return roster_member; },
      'start': function() { go(roster_member_state, 'warming'); return roster_member; },
    }
    return roster_member;
  }

  var paxos_proposer = null;
  var paxos_acceptor = null;
  var paxos_learner = null;

  routes_register('/paxos/promise_req');
  routes_register('/paxos/promise_res');
  routes_register('/paxos/accept_req');
  routes_register('/paxos/accept_res');

  function routes_register(message) {
    routes.post('/' + message,
                function(req, res) { go(node_state, message, req, res); });
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
  running_event('last_entry_executed', todo);

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
