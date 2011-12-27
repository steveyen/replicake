// Given a set of nodes...
// - subsets of those nodes participate in 1 or more immutable 'configurations'.
// - these configurations are created over time as nodes are added/removed.
// - multiple configurations might be running concurrently
//   and may overlap in their usage of nodes.
// - a configuration has a replica running on each participating node.
// - a replica might be started or running or finished or defunct
//   w.r.t. its configuration.
//
var assert = require('assert');

exports.open_replica = function(conf, log_db_module, routes) {
  var log_db = null;

  var time_start = new Date();
  var data_dir  = conf.get('data_dir');
  var name      = conf.get('name');

  console.info('replicake...')
  console.info('  time_start: ' + time_start.toJSON());
  console.info('  data_dir: ' + data_dir);
  console.info('  name: ' + name);

  if (name == null || name.toString().length <= 0) {
    console.error("ERROR: missing name for replicake configuration.");
    return null;
  }

  var state = { curr: 'opening' };

  on_transition(state, 'opening', 'warming',
                function() {
                  log_db_module.log_db_open(data_dir, name, conf.get('log_db'),
                                            function(err, log_db_in) {
                                              assert(log_db == null,
                                                     'log_db should be null');
                                              log_db = log_db_in;
                                              go(state, 'running');
                                            });
                });

  on_transition(state, 'warming', 'running',
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
                  // -- handle configuration changes
                });

  on_transition(state, 'warming', 'cooling', cool);
  on_transition(state, 'running', 'cooling', cool);
  on_transition(state, 'cooling', 'closed', function() {});

  function cool() {
    assert(log_db);
    log_db.save(function() {
        log_db.close();
        log_db = null;
        go(state, 'closed');
      });
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
                function(req, res) { go(state, message, req, res); });
  }

  on_transition(state, 'running', ['running', 'leader_ping_req'], leader_ping_req);
  on_transition(state, 'running', ['running', 'leader_ping_res'], leader_ping_res);
  on_transition(state, 'running', ['running', 'leader_ping_timeout'], leader_ping_timeout);

  on_transition(state, 'running', ['running', 'catchup_req'], catchup_req);
  on_transition(state, 'running', ['running', 'catchup_res'], catchup_res);
  on_transition(state, 'running', ['running', 'catchup_timeout'], catchup_timeout);

  on_transition(state, 'running', ['running', 'leader_race_run'], todo);
  on_transition(state, 'running', ['running', 'leader_race_win'], todo);
  on_transition(state, 'running', ['running', 'leader_race_lose'], todo);
  on_transition(state, 'running', ['running', 'leader_race_timeout'], todo);

  on_transition(state, 'running', ['running', 'log_entry_learned'], todo);
  on_transition(state, 'running', ['running', 'log_gc_timeout'], todo);

  on_transition(state, 'running', ['running', 'new_config'], todo);

  on_transition(state, 'running', ['running', 'snapshot_timeout'], todo);

  var max_defunct_config = null;

  on_transition(state, 'running', ['running', 'config_join'], todo);
  on_transition(state, 'running', ['running', 'config_join_request'], todo);
  on_transition(state, 'running', ['running', 'config_finished'], todo);
  on_transition(state, 'running', ['running', 'config_defunct'], todo);
  on_transition(state, 'running', ['running', 'config_created'], todo);
  on_transition(state, 'running', ['running', 'last_entry_executed'], todo);

  function leader_ping_req() {};
  function leader_ping_res() {};
  function leader_ping_timeout() {};

  function catchup_req() {};
  function catchup_res() {};
  function catchup_timeout() {};

  function broadcast() {};

  function todo() {};

  var self = {
    'go': function(to_state) { go(state, to_state); return self; },
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
