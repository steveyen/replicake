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

function mock_storage() {
  function get(slot) {
    storage.slots[slot] = storage.slots[slot] || {};
    return storage.slots[slot];
  }

  var storage = {
    "slots": {},
    "history": [],
    "slot_read": function(slot, cb) {
      var slot = get(slot);
      if (slot) {
        cb(false, {
            "highest_proposed_ballot": slot.highest_proposed_ballot,
            "accepted_ballot":         slot.accepted_ballot,
            "accepted_val":            slot.accepted_val });
      } else {
        cb("missing");
      }
    },
    "slot_save_highest_proposed_ballot": function(slot, hpb, cb) {
      storage.history[storage.history.length] =
        ["slot_save_highest_proposed_ballot", slot, hpb];
      var slot = get(slot);
      if (slot) {
        slot.highest_proposed_ballot = hpb;
        cb(false);
      } else {
        cb(true);
      }
    },
    "slot_save_accepted": function(slot, ballot, val, cb) {
      storage.history[storage.history.length] =
        ["slot_save_accepted", slot, ballot, val];
      var slot = get(slot);
      if (slot) {
        slot.accepted_ballot = ballot;
        slot.accepted_val = val;
        cb(false);
      } else {
        cb(true);
      }
    }
  };
  return storage;
}

var testi = -1; // Current test.

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

function propose_phase_test() {
  test_start("propose_phase_test");

  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], mock_comm('A'),
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
    paxos.proposer('A', 1, 0, ['B'], mock_comm('A'),
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
    paxos.proposer('A', 1, 0, ['B', 'C'], mock_comm('A'),
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

function paxos_1_1_half_test() {
  test_start("paxos_1_1_half_test");

  blackboard = {};
  var storage = blackboard.storage = mock_storage();
  var acceptor = blackboard.acceptor =
    paxos.acceptor(storage, mock_comm('B'));
  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], mock_comm('A'),
                   { proposer_timeout: 100 });

  proposer.propose(123, paxos_1_1_half_test_cb);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 1);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);

  acceptor.on_msg('A', blackboard.sends[0][1]);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 2);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);
  assert(blackboard.sends[1][0] == 'A');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  assert(acceptor.stats().tot_accept_recv == 1);
  assert(acceptor.stats().tot_accept_send == 1);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 0);
  assert(acceptor.stats().tot_accept_accepted == 0);

  // Never send proposed response, so we'll timeout.
}

function paxos_1_1_half_test_cb(err, info) {
  assert(err == "timeout");

  test_ok("paxos_1_1_half_test");
}

function paxos_1_1_test() {
  test_start("paxos_1_1_test");

  blackboard = {};
  var storage = blackboard.storage = mock_storage();
  var acceptor = blackboard.acceptor =
    paxos.acceptor(storage, mock_comm('B'));
  var proposer = blackboard.proposer =
    paxos.proposer('A', 1, 0, ['B'], mock_comm('A'),
                   { proposer_timeout: 100 });

  var p = proposer.propose(123, paxos_1_1_test_cb);

  assert(p && p.on_msg);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 1);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);

  acceptor.on_msg('A', blackboard.sends[0][1]);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 2);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);
  assert(blackboard.sends[1][0] == 'A');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  assert(acceptor.stats().tot_accept_recv == 1);
  assert(acceptor.stats().tot_accept_send == 1);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 0);
  assert(acceptor.stats().tot_accept_accepted == 0);

  p.on_msg('B', blackboard.sends[1][1]);

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.sends.length == 3);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].slot == 0);
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);
  assert(blackboard.sends[1][0] == 'A');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));
  assert(blackboard.sends[2][0] == 'B');
  assert(blackboard.sends[2][1].slot == 0);
  assert(blackboard.sends[2][1].kind == paxos.REQ_ACCEPT);
  assert(blackboard.sends[2][1].val == 123);
  assert(paxos.ballot_eq(blackboard.sends[2][1].ballot,
                         blackboard.sends[0][1].ballot));

  acceptor.on_msg('A', blackboard.sends[2][1]);

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.sends.length == 4);
  assert(blackboard.sends[0][0] == 'B');
  assert(blackboard.sends[0][1].slot == 0);
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);
  assert(blackboard.sends[1][0] == 'A');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));
  assert(blackboard.sends[2][0] == 'B');
  assert(blackboard.sends[2][1].slot == 0);
  assert(blackboard.sends[2][1].kind == paxos.REQ_ACCEPT);
  assert(blackboard.sends[2][1].val == 123);
  assert(paxos.ballot_eq(blackboard.sends[2][1].ballot,
                         blackboard.sends[0][1].ballot));
  assert(blackboard.sends[3][0] == 'A');
  assert(blackboard.sends[3][1].kind == paxos.RES_ACCEPTED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  p.on_msg('B', blackboard.sends[3][1]);
}

function paxos_1_1_test_cb(err, info) {
  assert(!err);
  assert(paxos.ballot_eq(info.highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  var proposer = blackboard.proposer;
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 0);
  assert(proposer.stats().tot_propose_send == 2);
  assert(proposer.stats().tot_propose_recv == 2);
  assert(proposer.stats().tot_propose_recv_err == 0);
  assert(proposer.stats().tot_propose_vote == 2);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  var acceptor = blackboard.acceptor;
  assert(acceptor.stats().tot_accept_bad_req == 0);
  assert(acceptor.stats().tot_accept_bad_req_kind == 0);
  assert(acceptor.stats().tot_accept_recv == 2);
  assert(acceptor.stats().tot_accept_send == 2);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 1);
  assert(acceptor.stats().tot_accept_accepted == 1);
  assert(acceptor.stats().tot_accept_nack_storage == 0);
  assert(acceptor.stats().tot_accept_nack_behind == 0);

  var storage = blackboard.storage;
  assert(storage.history[0][0] == "slot_save_highest_proposed_ballot");
  assert(storage.history[0][1] == 0);
  assert(paxos.ballot_eq(storage.history[0][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][0] == "slot_save_accepted");
  assert(storage.history[1][1] == 0);
  assert(paxos.ballot_eq(storage.history[1][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][3] == 123);

  test_ok("paxos_1_1_test");
}

// ------------------------------------------------

function test_gen_paxos(num_proposers, num_acceptors, quiet) {
  blackboard = { "proposers": [],
                 "acceptors": [],
                 "storages": [] };

  var acceptor_names = [];

  for (var i = 0; i < num_acceptors; i++) {
    var storage = blackboard.storages[blackboard.storages.length] =
      mock_storage();
    // Acceptors are named 'A', 'B', etc.
    var acceptor = blackboard.acceptors[blackboard.acceptors.length] =
      paxos.acceptor(storage, mock_comm(acceptor_name(i), quiet));
    acceptor_names[acceptor_names.length] = acceptor_name(i);
  }

  for (var i = 0; i < num_proposers; i++) {
    // Proposers are named 'a', 'b', etc.
    var proposer = blackboard.proposers[blackboard.proposers.length] =
      paxos.proposer(proposer_name(i), 1,
                     0, acceptor_names, mock_comm(proposer_name(i), quiet),
                     { proposer_timeout: 100 })
  }
}

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

function drive_comm(cb, label) {
  label = label || "";
  var proposers = blackboard.proposers;
  var proposals = blackboard.proposals = [];
  for (var i = 0; i < proposers.length; i++) {
    var val = 100 + i;
    log(label + "proposing: " + val + " to: " + proposer_name(i));
    proposals[i] = proposers[i].propose(val, cb);
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

function expect_rejected(err, info) {
  log('expect_rejected: ' + err + ", " + to_s(info));
  assert(err == 'rejected');
}

// ------------------------------------------------

function paxos_1_1_gen_test() {
  test_start("paxos_1_1_gen_test");

  test_gen_paxos(1, 1);

  var p = blackboard.proposers[0].propose(123, paxos_1_1_gen_test_cb);

  var acceptor = blackboard.acceptors[0];

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 1);
  assert(blackboard.sends[0][0] == 'A');
  assert(blackboard.sends[0][1].kind == paxos.REQ_PROPOSE);

  acceptor.on_msg('a', blackboard.sends[0][1]);

  assert(blackboard.broadcasts.length == 1);
  assert(blackboard.sends.length == 2);
  assert(blackboard.sends[1][0] == 'a');
  assert(blackboard.sends[1][1].kind == paxos.RES_PROPOSED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  p.on_msg('A', blackboard.sends[1][1]);

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.sends.length == 3);
  assert(blackboard.sends[2][0] == 'A');
  assert(blackboard.sends[2][1].slot == 0);
  assert(blackboard.sends[2][1].kind == paxos.REQ_ACCEPT);
  assert(blackboard.sends[2][1].val == 123);
  assert(paxos.ballot_eq(blackboard.sends[2][1].ballot,
                         blackboard.sends[0][1].ballot));

  acceptor.on_msg('a', blackboard.sends[2][1]);

  assert(blackboard.broadcasts.length == 2);
  assert(blackboard.sends.length == 4);
  assert(blackboard.sends[3][0] == 'a');
  assert(blackboard.sends[3][1].kind == paxos.RES_ACCEPTED);
  assert(paxos.ballot_eq(blackboard.sends[1][1].highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  p.on_msg('A', blackboard.sends[3][1]);
}

function paxos_1_1_gen_test_cb(err, info) {
  assert(!err);
  assert(paxos.ballot_eq(info.highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  var proposer = blackboard.proposers[0];
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 0);
  assert(proposer.stats().tot_propose_send == 2);
  assert(proposer.stats().tot_propose_recv == 2);
  assert(proposer.stats().tot_propose_recv_err == 0);
  assert(proposer.stats().tot_propose_vote == 2);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  var acceptor = blackboard.acceptors[0];
  assert(acceptor.stats().tot_accept_bad_req == 0);
  assert(acceptor.stats().tot_accept_bad_req_kind == 0);
  assert(acceptor.stats().tot_accept_recv == 2);
  assert(acceptor.stats().tot_accept_send == 2);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 1);
  assert(acceptor.stats().tot_accept_accepted == 1);
  assert(acceptor.stats().tot_accept_nack_storage == 0);
  assert(acceptor.stats().tot_accept_nack_behind == 0);

  var storage = blackboard.storages[0];
  assert(storage.history[0][0] == "slot_save_highest_proposed_ballot");
  assert(storage.history[0][1] == 0);
  assert(paxos.ballot_eq(storage.history[0][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][0] == "slot_save_accepted");
  assert(storage.history[1][1] == 0);
  assert(paxos.ballot_eq(storage.history[1][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][3] == 123);

  test_ok("paxos_1_1_gen_test");
}

function paxos_1_1_gensend_test() {
  test_start("paxos_1_1_gensend_test");
  test_gen_paxos(1, 1);
  drive_comm(paxos_1_1_gensend_test_cb);
}

function paxos_1_1_gensend_test_cb(err, info) {
  assert(!err);
  assert(paxos.ballot_eq(info.highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  var proposer = blackboard.proposers[0];
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 0);
  assert(proposer.stats().tot_propose_send == 2);
  assert(proposer.stats().tot_propose_recv == 2);
  assert(proposer.stats().tot_propose_recv_err == 0);
  assert(proposer.stats().tot_propose_vote == 2);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  var acceptor = blackboard.acceptors[0];
  assert(acceptor.stats().tot_accept_bad_req == 0);
  assert(acceptor.stats().tot_accept_bad_req_kind == 0);
  assert(acceptor.stats().tot_accept_recv == 2);
  assert(acceptor.stats().tot_accept_send == 2);
  assert(acceptor.stats().tot_accept_propose == 1);
  assert(acceptor.stats().tot_accept_proposed == 1);
  assert(acceptor.stats().tot_accept_accept == 1);
  assert(acceptor.stats().tot_accept_accepted == 1);
  assert(acceptor.stats().tot_accept_nack_storage == 0);
  assert(acceptor.stats().tot_accept_nack_behind == 0);

  var storage = blackboard.storages[0];
  assert(storage.history[0][0] == "slot_save_highest_proposed_ballot");
  assert(storage.history[0][1] == 0);
  assert(paxos.ballot_eq(storage.history[0][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][0] == "slot_save_accepted");
  assert(storage.history[1][1] == 0);
  assert(paxos.ballot_eq(storage.history[1][2],
                         info.highest_proposed_ballot));
  assert(storage.history[1][3] == 100);

  test_ok("paxos_1_1_gensend_test");
}

function paxos_1_2_gensend_test() {
  test_start("paxos_1_2_gensend_test");
  test_gen_paxos(1, 2);
  drive_comm(paxos_1_2_gensend_test_cb);
}

function paxos_1_2_gensend_test_cb(err, info) {
  assert(!err);
  assert(paxos.ballot_eq(info.highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  var proposer = blackboard.proposers[0];
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 2);
  assert(proposer.stats().tot_propose_send == 4);
  assert(proposer.stats().tot_propose_recv == 4);
  assert(proposer.stats().tot_propose_recv_err == 0);
  assert(proposer.stats().tot_propose_vote == 4);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  for (var i in blackboard.acceptors) {
    var acceptor = blackboard.acceptors[i];
    assert(acceptor.stats().tot_accept_bad_req == 0);
    assert(acceptor.stats().tot_accept_bad_req_kind == 0);
    assert(acceptor.stats().tot_accept_recv == 2);
    assert(acceptor.stats().tot_accept_send == 2);
    assert(acceptor.stats().tot_accept_propose == 1);
    assert(acceptor.stats().tot_accept_proposed == 1);
    assert(acceptor.stats().tot_accept_accept == 1);
    assert(acceptor.stats().tot_accept_accepted == 1);
    assert(acceptor.stats().tot_accept_nack_storage == 0);
    assert(acceptor.stats().tot_accept_nack_behind == 0);
  }

  for (var i in blackboard.storages) {
    var storage = blackboard.storages[i];
    assert(storage.history[0][0] == "slot_save_highest_proposed_ballot");
    assert(storage.history[0][1] == 0);
    assert(paxos.ballot_eq(storage.history[0][2],
                           info.highest_proposed_ballot));
    assert(storage.history[1][0] == "slot_save_accepted");
    assert(storage.history[1][1] == 0);
    assert(paxos.ballot_eq(storage.history[1][2],
                           info.highest_proposed_ballot));
    assert(storage.history[1][3] == 100);
  }

  test_ok("paxos_1_2_gensend_test");
}

function paxos_1_3_gensend_test() {
  test_start("paxos_1_3_gensend_test");
  test_gen_paxos(1, 3);
  drive_comm(paxos_1_3_gensend_test_cb);
}

function paxos_1_3_gensend_test_cb(err, info) {
  assert(!err);
  assert(paxos.ballot_eq(info.highest_proposed_ballot,
                         blackboard.sends[0][1].ballot));

  var proposer = blackboard.proposers[0];
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 3);
  assert(proposer.stats().tot_propose_send == 6);
  assert(proposer.stats().tot_propose_recv == 5);
  assert(proposer.stats().tot_propose_recv_err == 1);
  assert(proposer.stats().tot_propose_vote == 4);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  for (var i in blackboard.acceptors) {
    var acceptor = blackboard.acceptors[i];
    assert(acceptor.stats().tot_accept_bad_req == 0);
    assert(acceptor.stats().tot_accept_bad_req_kind == 0);
    assert(acceptor.stats().tot_accept_recv == 2);
    assert(acceptor.stats().tot_accept_send == 2);
    assert(acceptor.stats().tot_accept_propose == 1);
    assert(acceptor.stats().tot_accept_proposed == 1);
    assert(acceptor.stats().tot_accept_accept == 1);
    assert(acceptor.stats().tot_accept_accepted == 1);
    assert(acceptor.stats().tot_accept_nack_storage == 0);
    assert(acceptor.stats().tot_accept_nack_behind == 0);
  }

  for (var i in blackboard.storages) {
    var storage = blackboard.storages[i];
    assert(storage.history[0][0] == "slot_save_highest_proposed_ballot");
    assert(storage.history[0][1] == 0);
    assert(paxos.ballot_eq(storage.history[0][2],
                           info.highest_proposed_ballot));
    assert(storage.history[1][0] == "slot_save_accepted");
    assert(storage.history[1][1] == 0);
    assert(paxos.ballot_eq(storage.history[1][2],
                           info.highest_proposed_ballot));
    assert(storage.history[1][3] == 100);
  }

  test_ok("paxos_1_3_gensend_test");
}

function paxos_2_3_gensend_test() {
  test_start("paxos_2_3_gensend_test");
  test_gen_paxos(2, 3);
  var proposers = blackboard.proposers;
  drive_comm_proposals([ proposers[0].propose(100, expect_rejected),
                         proposers[1].propose(101, paxos_2_3_gensend_test_cb)
                         ]);
}

function paxos_2_3_gensend_test_cb(err, info) {
  assert(!err);

  var proposer = blackboard.proposers[blackboard.proposers.length - 1];
  assert(proposer.stats().tot_propose_phase == 2);
  assert(proposer.stats().tot_propose_phase_loop == 3);
  assert(proposer.stats().tot_propose_send == 6);
  assert(proposer.stats().tot_propose_recv == 5);
  assert(proposer.stats().tot_propose_recv_err == 1);
  assert(proposer.stats().tot_propose_vote == 4);
  assert(proposer.stats().tot_propose_vote_repeat == 0);
  assert(proposer.stats().tot_propose_timeout == 0);

  for (var i in blackboard.acceptors) {
    var acceptor = blackboard.acceptors[i];
    assert(acceptor.stats().tot_accept_bad_req == 0);
    assert(acceptor.stats().tot_accept_bad_req_kind == 0);
    assert(acceptor.stats().tot_accept_recv == 4);
    assert(acceptor.stats().tot_accept_send == 4);
    assert(acceptor.stats().tot_accept_propose == 2);
    assert(acceptor.stats().tot_accept_proposed == 2);
    assert(acceptor.stats().tot_accept_accept == 1);
    assert(acceptor.stats().tot_accept_accepted == 1);
    assert(acceptor.stats().tot_accept_nack_storage == 0);
    assert(acceptor.stats().tot_accept_nack_behind == 1);
  }

  for (var i in blackboard.storages) {
    var storage = blackboard.storages[i];
    assert(storage.slots[0].accepted_val == 101);
  }

  test_ok("paxos_2_3_gensend_test");
}

// ------------------------------------------------

function paxos_simple_reorderings_test() {
  test_start("paxos_simple_reorderings_test");

  // Test paxos will some simple message reorderings.
  // By simple, there are no dropped messages and no re-proposals.
  //
  var max_proposers = 1;
  var max_acceptors = 3;

  if (true) {
    for (var i = 1; i <= max_proposers; i++) {
      for (var j = 1; j <= max_acceptors; j++) {
        log("test " + i + " proposers, " + j + " acceptors");
        paxos_simple_reorderings_test_topology(i, j);
      }
    }
  }

  test_ok("paxos_simple_reorderings_test");
}

function paxos_simple_reorderings_test_topology(num_proposers,
                                                num_acceptors) {
  var unvisited = [];
  var unvisited_next = 0;
  var unvisited_seen = {};
  var pruned = 0;

  var acceptor_names = [];
  var acceptor_aliases = [];
  for (var i = 0; i < num_acceptors; i++) {
    acceptor_names.push(acceptor_name(i));        // Ex: ['A', 'B'].
    acceptor_aliases.push(acceptor_name(i, 'M')); // Ex: ['M', 'N'].
  }

  // Example aliases: [[["A","M"],["B","N"]],
  //                   [["A","N"],["B","M"]]].
  var aliases = mix(acceptor_names, acceptor_aliases);
  for (var a = 0; a < aliases.length; a++) {
    var map = {};
    var row = aliases[a];
    for (var i = 0; i < row.length; i++) {
      var pair = row[i];
      map[pair[0]] = pair[1];
    }
    aliases[a] = map;
  }

  // The aliases: [{'A':'M','B':'N'},
  //               {'A':'N','B':'M'}].
  var n = 0;
  while (true) {
    (function(n) {
      log("loop... " + n + ", " + num_proposers + ", " + num_acceptors);
      test_gen_paxos(num_proposers, num_acceptors, true);

      var num_callbacks = 0;
      var num_callback_oks = 0;
      var num_callback_errs = 0;
      var num_callback_timeouts = 0;

      var sends     = blackboard.sends;
      var acceptors = blackboard.acceptors;
      var proposers = blackboard.proposers;
      var proposals = blackboard.proposals = [];

      var accepted_val = null;

      assert(sends.length == 0);
      assert(acceptors.length == num_acceptors);
      assert(proposers.length == num_proposers);

      for (var i = 0; i < proposers.length; i++) {
        var val = 100 + i;
        proposals[i] = proposers[i].propose(val, mk_callback(i));
      }

      var replayed_sends = [];

      if (unvisited_next < unvisited.length) {
        log(n + "-replaying: " + unvisited_next);
        replayed_sends = unvisited[unvisited_next][0];
        for (var i = 0; i < replayed_sends.length; i++) {
          assert(replayed_sends[i]);
          if (i == replayed_sends.length - 1) {
            sends = blackboard.sends = unvisited[unvisited_next][1];
          }
          transmit(replayed_sends[i]);
        }
        log(n + "-replaying: " + unvisited_next + " done");
        unvisited_next++;
      }

      var done = false; // Flag allows quick exit, such to prune
                        // previously examined branches.

      while (!done &&
             blackboard != null &&
             blackboard.sends === sends &&
             sends.length > 0) {
        var next_to_send = sends[0];
        assert(next_to_send);

        for (var j = 1; !done && j < sends.length; j++) {
          var replay_next_time = clone(replayed_sends);
          replay_next_time[replay_next_time.length] = sends[j];
          var unvisited_next_time = [replay_next_time,
                                     clone(sends, [], 0, j)];
          var unvisited_next_time_s = JSON.stringify(unvisited_next_time);
          assert(!unvisited_seen[unvisited_next_time_s]);

          for (var a = 0; a < aliases.length; a++) {
            // See if our unvisited_next_time "path" is isomorphic to
            // some previously visited path so we can skip or prune
            // that path.  Use aliases to determine isomorphism.
            var map = aliases[a];
            var unvisited_aliased =
              unvisited_next_time_s.replace(/[A-Z]/g,
                                            function(x) { return map[x] || x; });
            if (unvisited_seen[unvisited_aliased]) {
              pruned++;
              done = true
              break;
            }
            unvisited_seen[unvisited_aliased] = true;
          }
          unvisited_seen[unvisited_next_time_s] = true;

          if (!done) {
            unvisited[unvisited.length] = unvisited_next_time;
          }
        }

        if (!done) {
          replayed_sends[replayed_sends.length] = next_to_send;
          blackboard.sends = sends = sends.slice(1);
          transmit(next_to_send);
        }
      }

      function transmit(to_send) {
        var dst = to_send[0];
        var dst_idx = name_idx(dst);
        var msg = to_send[1];
        var src = to_send[2];

        log(n + "-xmit: " + src + "->" + dst + ", " + to_s(msg));

        if (msg.kind == paxos.REQ_PROPOSE ||
            msg.kind == paxos.REQ_ACCEPT) {
          acceptors[dst_idx].on_msg(src, msg);
        } else {
          proposals[dst_idx].on_msg(src, msg);
        }
      }

      function mk_callback(label) {
        return function(err, info) {
          log(n + "-callback: " + label + ", " + err + ", " + to_s(info));

          num_callbacks++;
          assert(num_callbacks <= num_proposers);

          if (!err) {
            num_callback_oks++;

            assert(!accepted_val ||
                   (accepted_val == info.accepted_val));
            accepted_val = info.accepted_val;
          } else {
            num_callback_errs++;
            if (err == 'timeout') {
              num_callback_timeouts++;
            }
          }
        }
      }
    })(n);

    if (unvisited_next >= unvisited.length) {
      break;
    }

    if (unvisited_next >= 1000) {
      unvisited = unvisited.splice(1000);
      unvisited_next = 0;
    }

    n++;
  }

  log("pruned " + pruned);
}

// ------------------------------------------------

function clone(src, dst, start, skip) {
  dst = dst || [];
  start = start || 0;
  for (var i = start; i < src.length; i++) {
    if (skip == null ||
        skip != i) {
      dst[dst.length] = src[i];
    }
  }
  return dst;
}

function mix(abc, xyz) {
  var rv = [];
  if (abc.length > 0) {
    for (var j = 0; j < xyz.length; j++) {
      var chosen = [abc[0], xyz[j]];
      var rest = mix(abc.slice(1),
                     clone(xyz, [], 0, j));
      if (rest.length > 0) {
        for (var k = 0; k < rest.length; k++) {
          rv.push([chosen].concat(rest[k]));
        }
      } else {
        rv.push([chosen]);
      }
    }
  }
  return rv;
}

assert(to_s(mix(['A'], ['X'])) == '[[["A","X"]]]');
assert(to_s(mix(['A', 'B'], ['X', 'Y'])) ==
       '[[["A","X"],["B","Y"]],' +
        '[["A","Y"],["B","X"]]]');
assert(to_s(mix(['A', 'B', 'C'], ['X', 'Y', 'Z'])) ==
       '[[["A","X"],["B","Y"],["C","Z"]],' +
        '[["A","X"],["B","Z"],["C","Y"]],' +
        '[["A","Y"],["B","X"],["C","Z"]],' +
        '[["A","Y"],["B","Z"],["C","X"]],' +
        '[["A","Z"],["B","X"],["C","Y"]],' +
        '[["A","Z"],["B","Y"],["C","X"]]]');

// ------------------------------------------------

var tests = [ propose_phase_test,
              propose_two_test,
              propose_2_acceptors_test,
              paxos_1_1_half_test,
              paxos_1_1_test,
              paxos_1_1_gen_test,
              paxos_1_1_gensend_test,
              paxos_1_2_gensend_test,
              paxos_1_3_gensend_test,
              paxos_2_3_gensend_test,
              paxos_simple_reorderings_test,
            ];

test_ok("...");

