#!/usr/bin/env node

var assert = require('assert');
var paxos  = require('./paxos');
var lease  = require('./paxos_lease');

assert(lease.lease_acquirer);
assert(lease.lease_voter);

// ------------------------------------------------

function log(msg) { console.log("   " + msg); }

var to_s = JSON.stringify;
var testi = -1; // Current test.
var blackboard = {};

function test_start(test_name) {
  console.log(".. " + test_name);
  blackboard = {};
}

function test_ok(test_name) {
  console.log("ok " + test_name);
  blackboard = {};
  testi++;
  if (testi < tests.length) {
    tests[testi]();
  } else {
    console.log("DONE");
  }
}

// ------------------------------------------------

function acquirer_name(idx) { return String.fromCharCode(97 + idx); } // a.
function voter_name(idx, base) {
  base = base || 'A';
  return String.fromCharCode(base.charCodeAt(0) + idx);
}

function name_idx(name) {
  var idx = name.charCodeAt(0);
  if (idx >= 97) {
    idx = idx - 97;
  } else if (idx >= 65) {
    idx = idx - 65;
  }
  return idx;
}

// ------------------------------------------------

function mock_comm(name, quiet) {
  var bb = blackboard;
  bb.broadcasts = [];
  bb.sends = [];
  var comm = {
    "broadcast": function(voters, msg) {
      bb.broadcasts[bb.broadcasts.length] = [voters, msg];
      for (var i in voters) {
        comm.send(voters[i], msg);
      }
    },
    "send": function(dst, msg) {
      if (!quiet) {
        log("comm.heard: " + name + "->" + dst + ", " + JSON.stringify(msg));
      }
      bb.sends[bb.sends.length] = [dst, msg, name];
    }
  };
  return comm;
}

function test_gen_lease(num_acquirers, num_voters, lease_timeout,
                        quiet, opts) {
  blackboard = { "acquirers": [],
                 "voters": [] };

  opts = opts || {};
  opts.acquirer_timeout = opts.acquirer_timeout || 100;

  var voter_names = [];

  for (var i = 0; i < num_voters; i++) {
    // Voters are named 'A', 'B', etc.
    var voter = blackboard.voters[blackboard.voters.length] =
      lease.lease_voter(mock_comm(voter_name(i), quiet));
    voter_names[voter_names.length] = voter_name(i);
  }

  for (var i = 0; i < num_acquirers; i++) {
    // Acquirers are named 'a', 'b', etc.
    var acquirer = blackboard.acquirers[blackboard.acquirers.length] =
      lease.lease_acquirer(lease_timeout,
                           acquirer_name(i), 1,
                           voter_names,
                           mock_comm(acquirer_name(i), quiet), opts);
  }
}

function drive_comm(cb, label) {
  label = label || "";
  var acquirers = blackboard.acquirers;
  var proposals = blackboard.proposals = [];
  for (var i = 0; i < acquirers.length; i++) {
    log(label + "acquiring by: " + acquirer_name(i));
    proposals[i] = acquirers[i].acquire(cb);
  }
  drive_comm_proposals(proposals, label);
}

function drive_comm_proposals(proposals, label) {
  label = label || "";
  var acquirers = blackboard.acquirers;
  var voters = blackboard.voters;
  var sends = blackboard.sends;

  var i = 0;
  while (blackboard != null &&
         blackboard.sends === sends &&
         i < sends.length) {
    var dst = sends[i][0];
    var dst_idx = name_idx(dst);
    var msg = sends[i][1];
    var src = sends[i][2];
    log(label + "comm.txmit: " + i + ", " +
        dst + ", " + to_s(msg) + ", " + dst_idx);

    if (msg.kind == paxos.REQ_PROPOSE ||
        msg.kind == paxos.REQ_ACCEPT) {
      voters[dst_idx].on_msg(src, msg);
    } else {
      proposals[dst_idx].on_msg(src, msg);
    }

    i++;
  }
}

// ------------------------------------------------

function lease_basic_api_test() {
  test_start("lease_basic_api_test");

  var voter = lease.lease_voter(mock_comm('A'));
  assert(voter.on_msg);

  var acquirer = lease.lease_acquirer(20, "a", 1, ['A', 'B'],
                                      mock_comm('a', false),
                                      { "acquirer_timeout": 10 });
  blackboard.acquirer = acquirer;
  acquirer.acquire(lease_basic_api_test_cb);
}

function lease_basic_api_test_cb(err) {
  assert(err);
  assert(!blackboard.acquirer.is_owner());
  assert(!blackboard.acquirer.lease_owner());
  test_ok("lease_basic_api_test");
}

// ------------------------------------------------

function lease_1_acquirer_test(name, num_voters) {
  function lease_test() { // 1 acquirer, multiple voters.
    test_start(name);
    test_gen_lease(1, num_voters, 20, false);
    blackboard.acquire_attempts = 1;
    drive_comm(lease_test_cb);
  }

  function lease_test_cb(err) {
    log(name + "_cb " + to_s(err));
    assert(!err);
    assert(blackboard.acquirers[0].is_owner());
    assert(blackboard.acquirers[0].lease_owner() == acquirer_name(0));

    for (var i = 0; i < blackboard.voters.length; i++) {
      assert(blackboard.voters[i].lease_owner() == acquirer_name(0));
    }

    setTimeout(function() {
        log("check lease expired"); // Lease should have expired.
        assert(!blackboard.acquirers[0].is_owner());
        assert(!blackboard.acquirers[0].lease_owner());

        for (var i = 0; i < blackboard.voters.length; i++) {
          assert(!blackboard.voters[i].lease_owner());
        }

        if (blackboard.acquire_attempts < 3) { // Reacquisition tests.
          blackboard.acquire_attempts++;
          blackboard.sends.length = 0;
          drive_comm(lease_test_cb);
        } else {
          test_ok(name);
        }
      }, 30);
  }

  return lease_test;
}

// ------------------------------------------------

function lease_multi_acquirer_test(name, num_acquirers, num_voters) {
  function lease_test() {
    test_start(name);
    test_gen_lease(num_acquirers, num_voters, 20, false);

    var bb = blackboard;
    bb.cb_count = 0;

    var acquirers = bb.acquirers;
    var proposals = bb.proposals = [];
    for (var i = 0; i < acquirers.length; i++) {
      var cb = (function(i) {
          return function(err) {
            bb.cb_count++;
            if (bb.cb_count >= 2) {
              var owner = null;
              for (var j = 0; j < bb.acquirers.length; j++) {
                if (bb.acquirers[j].is_owner()) {
                  assert(!owner);
                  owner = bb.acquirers[j].lease_owner();
                  assert(owner);
                }
              }
              for (var j = 0; j < bb.acquirers.length; j++) {
                assert(bb.acquirers[j].lease_owner() == null ||
                       bb.acquirers[j].lease_owner() == owner);
              }
              if (bb == blackboard) {
                test_ok(name);
              }
            }
          }
        })(i);
      proposals[i] = acquirers[i].acquire(cb);
    }
    drive_comm_proposals(proposals);
  }

  return lease_test;
}

// ------------------------------------------------

function lease_1_renew_test(name, num_voters, max_renewals) {
  function lease_test() { // 1 acquirer, multiple voters.
    test_start(name);

    var opts = {
      "renew_timeout": 15,
      "on_renew": function(err) {
        blackboard.renewals++;
        log("renewal " + blackboard.renewals);
        if (blackboard.renewals >= max_renewals) {
          opts.renew_timeout = 0;
          test_ok(name);
        } else {
          drive_comm(lease_test_cb);
        }
      }
    };
    test_gen_lease(1, num_voters, 20, false, opts);
    blackboard.renewals = 0;
    drive_comm(lease_test_cb);
  }

  function lease_test_cb(err) {
    log(name + "_cb " + to_s(err));
    assert(!err);
    assert(blackboard.acquirers[0].is_owner());
    assert(blackboard.acquirers[0].lease_owner() == acquirer_name(0));

    for (var i = 0; i < blackboard.voters.length; i++) {
      assert(blackboard.voters[i].lease_owner() == acquirer_name(0));
    }
  }

  return lease_test;
}

// ------------------------------------------------

var tests = [ lease_basic_api_test,
              lease_1_acquirer_test("lease_1_voter_test", 1),
              lease_1_acquirer_test("lease_2_voter_test", 2),
              lease_1_acquirer_test("lease_3_voter_test", 3),
              lease_1_acquirer_test("lease_10_voter_test", 10),
              lease_multi_acquirer_test("lease_2_1_test", 2, 1),
              lease_multi_acquirer_test("lease_2_2_test", 2, 2),
              lease_multi_acquirer_test("lease_3_1_test", 3, 1),
              lease_multi_acquirer_test("lease_3_2_test", 3, 2),
              lease_multi_acquirer_test("lease_3_10_test", 3, 10),
              lease_multi_acquirer_test("lease_10_10_test", 10, 10),
              // lease_1_renew_test("lease_renew_1_voter_test", 1, 3),
              // lease_1_renew_test("lease_renew_2_voter_test", 2, 3),
            ];

test_ok("...");

