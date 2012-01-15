var assert = require('assert');
var paxos  = require('./paxos');

// Algorithm adapted from: "PaxosLease: Diskless Paxos for Leases",
// by Trencseni, Gazso, Reinhardt.
//
exports.lease_acquirer = function(lease_timeout,
                                  node_name, node_restarts, acceptors, comm, opts) {
  opts = opts || {};
  opts.msg_preprocess = function(src, msg) {
    if (msg.kind == paxos.RES_PROPOSED) {
      if (msg.accepted_ballot != null ||
          msg.accepted_val != null) {
        msg.kind = paxos.RES_NACK;
      }
    }

    return msg;
  };
  opts.on_phase_complete = function(kind, err) {
    if (kind == paxos.RES_PROPOSED && !err) {
      timer_clear(timer);
      timer = timer_start(lease_timeout, function() { owner = 'timeout'; });
    }
  };

  var timer    = null;
  var owner    = false; // Tri-state: true, false, 'timeout'.
  var proposer = paxos.proposer(node_name, node_restarts, acceptors, 0, comm, opts);

  function acquire(cb) {
    proposer.propose({ "lease_owner"   : node_name,
                       "lease_timeout" : lease_timeout },
                     function(err, info) {
                       if (!err &&
                           owner == false) {
                         owner = true;
                       }
                       cb(is_owner());
                     });
  }

  function is_owner() { return owner == true; }

  return { "acquire": acquire,
           "is_owner": is_owner };
};

exports.lease_acceptor = function(comm, opts) {
  var highest_proposed_ballot = null;
  var accepted_ballot         = null;
  var accepted_val            = null;
  var timer                   = null;

  opts = opts || {};
  opts.respond_preprocess = function(msg) {
    msg.accepted_ballot = accepted_ballot;
    msg.accepted_val    = accepted_val;
    return msg;
  }

  var lease_storage = {
    "slot_read": function(slot, cb) {
      assert(slot == 0);
      cb(false, { "highest_proposed_ballot": highest_proposed_ballot,
                  "accepted_ballot":         accepted_ballot,
                  "accepted_val":            accepted_val });
    },
    "slot_save_highest_proposed_ballot": function(slot, ballot, cb) {
      assert(slot == 0);
      highest_proposed_ballot = ballot;
      cb(false);
    },
    "slot_save_accepted": function(slot, ballot, val, cb) {
      assert(slot == 0);
      accepted_ballot = ballot;
      accepted_val    = null;

      timer_clear(timer);
      timer = timer_start(val.lease_timeout,
                          function() {
                            accepted_ballot = null;
                            accepted_val    = null;
                          });
      cb(false);
    }
  };

  return paxos.acceptor(lease_storage, comm, opts);
};
