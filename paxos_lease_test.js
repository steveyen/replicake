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

function proposer_name(idx) { return String.fromCharCode(97 + idx); } // a.
function acceptor_name(idx, base) {
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
    "broadcast": function(acceptors, msg) {
      bb.broadcasts[bb.broadcasts.length] = [acceptors, msg];
      for (var i in acceptors) {
        comm.send(acceptors[i], msg);
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

function test_gen_lease(num_proposers, num_acceptors, quiet) {
  blackboard = { "proposers": [],
                 "acceptors": [] };

  var acceptor_names = [];

  for (var i = 0; i < num_acceptors; i++) {
    // Acceptors are named 'A', 'B', etc.
    var acceptor = blackboard.acceptors[blackboard.acceptors.length] =
      lease.lease_voter(mock_comm(acceptor_name(i), quiet));
    acceptor_names[acceptor_names.length] = acceptor_name(i);
  }

  for (var i = 0; i < num_proposers; i++) {
    // Proposers are named 'a', 'b', etc.
    var proposer = blackboard.proposers[blackboard.proposers.length] =
      lease.lease_acquirer(200,
                           proposer_name(i), 1,
                           acceptor_names,
                           mock_comm(proposer_name(i), quiet),
                           { proposer_timeout: 100 })
  }
}

function drive_comm(cb, label) {
  label = label || "";
  var proposers = blackboard.proposers;
  var proposals = blackboard.proposals = [];
  for (var i = 0; i < proposers.length; i++) {
    log(label + "acquiring by: " + proposer_name(i));
    proposals[i] = proposers[i].acquire(cb);
  }
  drive_comm_proposals(proposals, label);
}

function drive_comm_proposals(proposals, label) {
  label = label || "";
  var proposers = blackboard.proposers;
  var acceptors = blackboard.acceptors;
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
      acceptors[dst_idx].on_msg(src, msg);
    } else {
      proposals[dst_idx].on_msg(src, msg);
    }

    i++;
  }
}

function expect_not_acquired(is_owner, lease_owner) {
  log('expect_not_acquired: ' + is_owner + ", " + lease_owner);
  assert(!is_owner);
}

// ------------------------------------------------

function lease_basic_api_test() {
  test_start("lease_basic_api_test");

  var voter = lease.lease_voter(mock_comm('A'));
  assert(voter.on_msg);

  var acquirer = lease.lease_acquirer(20, "a", 1, ['A', 'B'],
                                      mock_comm('a', false),
                                      { "proposer_timeout": 10 });
  acquirer.acquire(lease_basic_api_test_cb);
}

function lease_basic_api_test_cb(is_owner, lease_owner) {
  log('lease_basic_api_test_cb: ' + is_owner + ", " + lease_owner);
  assert(!is_owner);
  assert(!lease_owner);
  test_ok("lease_basic_api_test");
}

// ------------------------------------------------

function lease_1_1_test() { // 1 acquirer, 1 voter.
  test_start("lease_1_1_test");
  test_gen_lease(1, 1, false);
  drive_comm(lease_1_1_test_cb);
}

function lease_1_1_test_cb(is_owner, lease_owner) {
  log('lease_1_1_test_cb: ' + is_owner + ", " + lease_owner);
  assert(is_owner);
  assert(lease_owner == proposer_name(0));
  test_ok("lease_1_1_test");
}

// ------------------------------------------------

var tests = [ lease_basic_api_test,
              lease_1_1_test
            ];

test_ok("...");

