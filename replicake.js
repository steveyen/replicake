var assert = require('assert');

exports.run_replica = function(conf) {
  return exports.init_replica(conf).go("warming");
}

exports.init_replica = function(conf) {
  var time_start = new Date();
  var data_dir  = conf.get('data_dir');
  var seeds     = conf.get('seeds');
  var name      = conf.get('name');

  console.info("replicake...")
  console.info("  time_start: " + time_start.toJSON());
  console.info("  data_dir: " + data_dir);
  console.info("  seeds: " + seeds);
  console.info("  name: " + name);

  var state = { curr: "initial" };
  var log_db = null;

  from_to(state, "initial", "warming",
          function() {
            log_db_load(data_dir, name, conf.get('log_db'),
                        function(err, log_db_in) {
                          assert(log_db == null, 'log_db should be null')
                          log_db = log_db_in;
                          go(state, "running");
                        });
          });

  from_to(state, "warming", "running",
          function() {
            assert(log_db);
            // Concurrently...
            // -- find and/or help choose leader
            // -- start paxos participation / log replica
            // -- continually catchup on log holes
            // -- help others catchup on log holes
            // -- take local snapshots
            // -- garbage collect old log entries
            // -- handle configuration changes
          });

  from_to(state, "warming", "cooling", cool);
  from_to(state, "running", "cooling", cool);
  from_to(state, "cooling", "stopped", function() {});

  function cool() {
    log_db_save(log_db, function() {
                  go(state, "stopped");
                });
  }

  var self = {
    "go": function(to_state) { go(state, to_state); return self; }
  };

  return self;
};

// Log DB helpers.

function log_db_load(data_dir, name, log_db, cb) {
}

function log_db_save(log_db, cb) {
}

// State machine helpers.

function from_to(state, from_state, to_state, cb) {
  state.transitions = state.transitions || {};
  assert(state.transitions[from_state + " => " + to_state] == null);
  state.transitions[from_state + " => " + to_state] = cb;
}

function go(state, to_state) {
  state.hist = state.hist || [];
  assert(state.curr);
  var transition = state.curr + " => " + to_state;
  console.info("transition: " + transition);
  assert(state.transitions[transition]);
  state.hist[state.hist.length] = (new Date().toJSON()) + ": " + transition;
  state.curr = to_state;
  state.transitions[transition]();
}
