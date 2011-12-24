var assert = require('assert');

exports.open_replica = function(conf, log_db_module) {
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

  var state = { curr: 'opened' };

  on_transition(state, 'opened', 'warming',
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

  var self = {
    'go': function(to_state) { go(state, to_state); return self; },
    'warm': function() { self.go("warming"); return self; }
  };

  return self;
};

// State machine helpers.

function on_transition(state, from_state, to_state, cb) {
  state.transitions = state.transitions || {};
  assert(state.transitions[from_state + ' => ' + to_state] == null);
  state.transitions[from_state + ' => ' + to_state] = cb;
}

function go(state, to_state) {
  state.hist = state.hist || [];
  assert(state.curr);
  var transition = state.curr + ' => ' + to_state;
  console.info('transition: ' + transition);
  assert(state.transitions[transition]);
  state.hist[state.hist.length] = (new Date().toJSON()) + ': ' + transition;
  state.curr = to_state;
  state.transitions[transition]();
}
