#!/usr/bin/env node

var assert = require('assert');
var paxos  = require('./paxos');

function ballot_test() {
  console.log(".. ballot_test");
  with (paxos) {
    var a = ballot_mk(1, 0, 0);
    assert(ballot_gte(a, ballot_mk(-1, -1, -1)));
    assert(ballot_gte(ballot_mk(1, 1, 1), a));
    assert(ballot_gte(ballot_mk(1, 1, 0), a));
    assert(ballot_gte(ballot_mk(1, 0, 1), a));
    assert(ballot_gte(ballot_mk(1, 0, 0), a));
    assert(!ballot_gte(ballot_mk(0, 0, 0), a));
    assert(!ballot_gte(ballot_mk(0, 0, 1), a));
    assert(!ballot_gte(ballot_mk(0, 1, 0), a));
    assert(!ballot_gte(ballot_mk(0, 1, 1), a));
    assert(ballot_gte(ballot_inc(a), a));
    assert(ballot_gte(a, a));
    assert(ballot_eq(a, a));
    assert(!ballot_eq(ballot_inc(a), a));
  }
  console.log("ok ballot_test");
}
ballot_test();

function majority_test() {
  console.log(".. majority_test");
  with (paxos) {
    assert(majority(4) == 3);
    assert(majority(3) == 2);
    assert(majority(2) == 2);
    assert(majority(1) == 1);
    assert(majority(0) == 1);
  }
  console.log("ok majority_test");
}
majority_test();

function is_member_test() {
  console.log(".. is_member_test");
  with (paxos) {
    assert(is_member([10], 10));
    assert(is_member([10,20], 10));
    assert(is_member([10,20], 20));
    assert(!is_member([10,20], 30));
    assert(!is_member([10], 30));
    assert(!is_member([], 30));
  }
  console.log("ok is_member_test");
}
is_member_test();

function create_test() {
  console.log(".. create_test");
  with (paxos) {
    assert(proposer('A', 1, 0, ['A'], null, null));
    try {
      proposer('A', 1, 0, [], null, null);
      assert(false);
    } catch (ex) { assert(ex); }
    assert(acceptor({}, {}));
  }
  console.log("ok create_test");
}
create_test();

// ------------------------------------------------

function log(msg) { console.log("   " + msg); }

var to_s = JSON.stringify;
var blackboard = {};

function mock_comm(label) {
  label = label || "";
  if (label.length > 0) {
    label = label + " ";
  }
  blackboard.broadcasts = [];
  blackboard.sends = [];
  var comm = {
    "broadcast": function(acceptors, msg) {
      log(label + "received: " + acceptors + ", " + JSON.stringify(msg));
      blackboard.broadcasts[blackboard.broadcasts.length] = [acceptors, msg];
      for (var i in acceptors) {
        comm.send(acceptors[i], msg);
      }
    },
    "send": function(dst, msg) {
      blackboard.sends[blackboard.sends.length] = [dst, msg];
    }
  };
  return comm;
}

var testi = -1; // Current test.

function test_start(test_name) {
  console.log(".. " + test_name);
}

function test_ok(test_name) {
  console.log("ok " + test_name);
  testi++;
  if (testi < tests.length) {
    tests[testi]();
  } else {
    console.log("DONE");
  }
}

// ------------------------------------------------

function propose_phase_test() {
  test_start("propose_phase_test");

  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], mock_comm(),
                   { proposer_timeout: 100 });
  proposer.propose(123, propose_phase_test_cb);
}

function propose_phase_test_cb(err, info) {
  assert(err == 'timeout');
  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.broadcasts[0][0].length == 1);
  assert(blackboard.broadcasts[0][0][0] == 'B');
  assert(blackboard.broadcasts[0][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(blackboard.broadcasts[0][1].ballot,
                         paxos.ballot_mk(0, 'A', 1)));
  assert(blackboard.proposer.stats().tot_propose_phase == 1);

  test_ok("propose_phase_test");
}

function propose_two_test() {
  test_start("propose_two_test");

  // Two propose() calls.
  blackboard.callback_count = 0;
  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], mock_comm(),
                   { proposer_timeout: 100 });
  proposer.propose(123, propose_two_test_cb);
  proposer.propose(234, propose_two_test_cb);
}

function propose_two_test_cb(err, info) {
  // Should be called twice.
  assert(err == 'timeout');
  blackboard.callback_count++;
  assert(blackboard.callback_count <= 2);
  if (blackboard.callback_count < 2) {
    return;
  }

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.broadcasts[0][0].length == 1);
  assert(blackboard.broadcasts[0][0][0] == 'B');
  assert(blackboard.broadcasts[0][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(blackboard.broadcasts[0][1].ballot,
                         paxos.ballot_mk(0, 'A', 1)));
  assert(blackboard.broadcasts[1][0].length == 1);
  assert(blackboard.broadcasts[1][0][0] == 'B');
  assert(blackboard.broadcasts[1][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(blackboard.broadcasts[1][1].ballot,
                         paxos.ballot_mk(1, 'A', 1)));
  assert(blackboard.proposer.stats().tot_propose_phase == 2);

  test_ok("propose_two_test");
}

function propose_2_acceptors_test() {
  test_start("propose_2_acceptors_test");

  blackboard.callback_count = 0;
  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B', 'C'], mock_comm(),
                   { proposer_timeout: 100 });
  proposer.propose(123, propose_2_acceptors_test_cb);
}

function propose_2_acceptors_test_cb(err, info) {
  assert(err == 'timeout');
  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.broadcasts[0][0].length == 2);
  assert(blackboard.broadcasts[0][0][0] == 'B');
  assert(blackboard.broadcasts[0][0][1] == 'C');
  assert(blackboard.broadcasts[0][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(blackboard.broadcasts[0][1].ballot,
                         paxos.ballot_mk(0, 'A', 1)));
  assert(blackboard.proposer.stats().tot_propose_phase == 1);
  assert(blackboard.proposer.stats().tot_propose_send == 2);

  test_ok("propose_2_acceptors_test");
}

function paxos_1_1_test() {
  test_start("paxos_1_1_test");

  blackboard = { comm: mock_comm() };
  var storage = blackboard.storage =
    { "slot_read": function() {},
      "slot_save_highest_proposed_ballot": function() {},
      "slot_save_accepted": function() {}
    };
  var acceptor = blackboard.acceptor =
    paxos.acceptor(storage, blackboard.comm);
  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], blackboard.comm,
                   { proposer_timeout: 100 });
  proposer.propose(123, propose_2_acceptors_test1);

  test_ok("ok paxos_1_1_test");
}

var tests = [ propose_phase_test,
              propose_two_test,
              propose_2_acceptors_test,
             ];

test_ok("...");

