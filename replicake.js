var assert = require('assert');

exports.open_replica = function(conf, log_db_module, routes) {
  var log_db = null;

  var time_start = new Date();
  var data_dir  = conf.get('data_dir');
  var seeds     = conf.get('seeds');
  var name      = conf.get('name');

  console.info('replicake...')
  console.info('  time_start: ' + time_start.toJSON());
  console.info('  data_dir: ' + data_dir);
  console.info('  seeds: ' + seeds);
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

  on_transition(state, 'running', 'leader_ping_req', leader_ping_req, 'running');
  on_transition(state, 'running', 'leader_ping_res', leader_ping_res, 'running');
  on_transition(state, 'running', 'leader_ping_timeout', leader_ping_timout, 'running');
  on_transition(state, 'running', 'catchup_req', catchup_req, 'running');
  on_transition(state, 'running', 'catchup_res', catchup_res, 'running');
  on_transition(state, 'running', 'catchup_timeout', catchup_timeout, 'running');

  on_transition(state, 'running', 'leader_race_run', todo, 'running');
  on_transition(state, 'running', 'leader_race_win', todo, 'running');
  on_transition(state, 'running', 'leader_race_lose', todo, 'running');
  on_transition(state, 'running', 'leader_race_timeout', todo, 'running');

  on_transition(state, 'running', 'log_entry_learned', todo, 'running');
  on_transition(state, 'running', 'log_gc_timeout', todo, 'running');

  on_transition(state, 'running', 'new_config', todo, 'running');

  on_transition(state, 'running', 'snapshot_timeout', todo, 'running');

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

function on_transition(state, from_state, to_state, cb, to_state_actual) {
  state.transitions = state.transitions || {};
  assert(state.transitions[from_state + ' => ' + to_state] == null);
  state.transitions[from_state + ' => ' + to_state] = [cb, to_state_actual];
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
