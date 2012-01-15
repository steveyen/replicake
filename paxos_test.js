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
  }
  console.log("ok create_test");
}
create_test();

// ------------------------------------------------

var broadcasts = []; // Records all the broadcasts by a mock comm.
function mock_comm(label) {
  label = label || "";
  if (label.length > 0) {
    label = label + " ";
  }
  broadcasts = [];
  var comm = {
    "broadcast": function(acceptors, msg) {
      log(label + "received: " + acceptors + ", " + JSON.stringify(msg));
      broadcasts[broadcasts.length] = [acceptors, msg];
    }
  };
  return comm;
}

function log(msg) {
  console.log("     " + msg);
}

var state = {};

propose_phase_test();

function propose_phase_test() {
  console.log(".. propose_phase_test");
  var proposer = paxos.proposer('A', 1, 0, ['B'], mock_comm(),
                                { proposer_timeout: 100 });
  proposer.propose(123, propose_phase_test1);
}

function propose_phase_test1(err, info) {
  assert(err == 'timeout');
  assert(broadcasts.length == 1);
  assert(broadcasts[0][0] == 'B');
  assert(broadcasts[0][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(broadcasts[0][1].ballot,
                         paxos.ballot_mk(0, 'A', 1)));

  log("propose_phase_test1... done");

  // Two propose() calls.
  state.callback_count = 0;
  var proposer = paxos.proposer('A', 1, 0, ['B'], mock_comm(),
                                { proposer_timeout: 100 });
  proposer.propose(123, propose_phase_test2);
  proposer.propose(234, propose_phase_test2);
}

function propose_phase_test2(err, info) {
  // Should be called twice.
  assert(err == 'timeout');
  state.callback_count++;
  assert(state.callback_count <= 2);
  if (state.callback_count < 2) {
    return;
  }

  assert(broadcasts.length == 2);
  assert(broadcasts[0][0] == 'B');
  assert(broadcasts[0][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(broadcasts[0][1].ballot,
                         paxos.ballot_mk(0, 'A', 1)));
  assert(broadcasts[1][0] == 'B');
  assert(broadcasts[1][1].kind == paxos.REQ_PROPOSE);
  assert(paxos.ballot_eq(broadcasts[1][1].ballot,
                         paxos.ballot_mk(1, 'A', 1)));

  log("propose_phase_test2... done");

  console.log("ok propose_phase_test");

  done();
}

function done() {
  console.log("DONE.");
}

