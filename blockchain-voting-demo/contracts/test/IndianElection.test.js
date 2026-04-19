const { expect } = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");

describe("IndianElection — ECI Compliance Tests", function () {
  let election, owner, ec1, voter1, voter2, voter3, attacker;

  // Simulated identity hashes (never raw Aadhaar/EPIC on chain)
  const voter1AadhaarHash = ethers.keccak256(ethers.toUtf8Bytes("123456789012"));
  const voter1EpicHash    = ethers.keccak256(ethers.toUtf8Bytes("ABC1234567"));
  const voter2AadhaarHash = ethers.keccak256(ethers.toUtf8Bytes("987654321098"));
  const voter2EpicHash    = ethers.keccak256(ethers.toUtf8Bytes("XYZ9876543"));
  const voter3AadhaarHash = ethers.keccak256(ethers.toUtf8Bytes("111222333444"));
  const voter3EpicHash    = ethers.keccak256(ethers.toUtf8Bytes("DEF4567890"));

  beforeEach(async () => {
    [owner, ec1, voter1, voter2, voter3, attacker] = await ethers.getSigners();

    const IndianElection = await ethers.getContractFactory("IndianElection");
    election = await IndianElection.deploy("Test Election 2024", 3);
    await election.waitForDeployment();

    // Add EC validator
    await election.addValidator(ec1.address);

    // Add candidates to constituency 1
    await election.addCandidate("Aarav Kumar", "Bharatiya Lok Dal", "🌸", 1, false);
    await election.addCandidate("Priya Sharma", "Indian National Front", "✋", 1, false);
    await election.addCandidate("None of the Above", "NOTA", "🚫", 1, true);

    // Register voters
    await election.registerVoter(voter1.address, voter1AadhaarHash, voter1EpicHash, 1);
    await election.registerVoter(voter2.address, voter2AadhaarHash, voter2EpicHash, 1);
    await election.registerVoter(voter3.address, voter3AadhaarHash, voter3EpicHash, 1);
  });

  // ── Phase Tests ──────────────────────────────────────────────────────────

  describe("Phase Enforcement (Booth Capturing Prevention)", () => {
    it("Should NOT allow voting during REGISTRATION phase", async () => {
      await expect(
        election.connect(voter1).castVote(0)
      ).to.be.revertedWith("Action not allowed in current election phase");
    });

    it("Should transition to VOTING phase when startVoting is called", async () => {
      await election.startVoting(3600);
      expect(await election.currentPhase()).to.equal(1); // Phase.VOTING
    });

    it("Should NOT allow non-owner to start voting", async () => {
      await expect(
        election.connect(attacker).startVoting(3600)
      ).to.be.revertedWithCustomError(election, "OwnableUnauthorizedAccount");
    });
  });

  // ── Voter Registration Tests ─────────────────────────────────────────────

  describe("Voter Identity (Impersonation Prevention)", () => {
    it("Should reject duplicate Aadhaar hash registration", async () => {
      // voter1's Aadhaar used again for attacker's address
      await expect(
        election.registerVoter(attacker.address, voter1AadhaarHash, ethers.keccak256(ethers.toUtf8Bytes("new_epic")), 1)
      ).to.be.revertedWith("Aadhaar already registered");
    });

    it("Should reject duplicate EPIC card hash registration", async () => {
      await expect(
        election.registerVoter(attacker.address, ethers.keccak256(ethers.toUtf8Bytes("new_aadhaar")), voter1EpicHash, 1)
      ).to.be.revertedWith("EPIC card already registered");
    });

    it("Should reject registering same address twice", async () => {
      await expect(
        election.registerVoter(voter1.address, voter3AadhaarHash, voter3EpicHash, 1)
      ).to.be.revertedWith("Voter already registered");
    });

    it("Should reject unregistered voter attempting to vote", async () => {
      await election.startVoting(3600);
      await expect(
        election.connect(attacker).castVote(0)
      ).to.be.revertedWith("You are not a registered voter");
    });
  });

  // ── Voting Tests ─────────────────────────────────────────────────────────

  describe("One-Person-One-Vote & VVPAT", () => {
    beforeEach(async () => {
      await election.startVoting(3600);
    });

    it("Should allow registered voter to cast vote and emit VoteCast", async () => {
      const tx = await election.connect(voter1).castVote(0);
      const receipt = await tx.wait();
      // Verify event was emitted (vvpatHash is dynamic so we just check it was cast)
      const event = receipt.logs.find(l => l.fragment?.name === "VoteCast");
      expect(event).to.not.be.undefined;
      expect(event.args.voter).to.equal(voter1.address);
      expect(event.args.candidateId).to.equal(0n);
      expect(event.args.constituencyId).to.equal(1n);
      expect(event.args.vvpatHash).to.not.equal(ethers.ZeroHash);
    });

    it("✅ ONE-PERSON-ONE-VOTE: Should reject second vote from same wallet", async () => {
      await election.connect(voter1).castVote(0);
      await expect(
        election.connect(voter1).castVote(0)
      ).to.be.revertedWith("You have already voted -- one vote per citizen");
    });

    it("Should reject voting for candidate in wrong constituency", async () => {
      // Create a fresh election to add candidate in constituency 2 BEFORE voting starts
      const IndianElection2 = await ethers.getContractFactory("IndianElection");
      const e2 = await IndianElection2.deploy("Test2", 2);
      await e2.waitForDeployment();
      await e2.addCandidate("C1 Cand", "Party", "X", 1, false); // id 0
      await e2.addCandidate("C2 Cand", "Party", "Y", 2, false); // id 1
      // Self-register voter as constituency 1
      const a1 = ethers.keccak256(ethers.toUtf8Bytes("test_aadhaar"));
      const e1 = ethers.keccak256(ethers.toUtf8Bytes("test_epic"));
      await e2.selfRegister(a1, e1, 1);
      await e2.startVoting(3600);
      // Candidate id 1 is constituency 2, voter is constituency 1
      await expect(
        e2.castVote(1)
      ).to.be.revertedWith("Candidate does not belong to your constituency");
    });

    it("Should generate and store VVPAT receipt on vote", async () => {
      await election.connect(voter1).castVote(0);
      const [receiptHash, voted, votedAt] = await election.getVVPATReceipt(voter1.address);
      expect(voted).to.be.true;
      expect(receiptHash).to.not.equal(ethers.ZeroHash);
      expect(votedAt).to.be.greaterThan(0);
    });
  });

  // ── NOTA Test ────────────────────────────────────────────────────────────

  describe("NOTA (Supreme Court 2013 Mandate)", () => {
    it("NOTA should be present in every constituency setup", async () => {
      const candidates = await election.getConstituencyCandidates(1);
      const nota = candidates.find(c => c.isNOTA);
      expect(nota).to.not.be.undefined;
      expect(nota.name).to.equal("None of the Above");
    });

    it("Should allow voting for NOTA", async () => {
      await election.startVoting(3600);
      const candidates = await election.getConstituencyCandidates(1);
      const notaIndex = candidates.findIndex(c => c.isNOTA);
      // Find NOTA's global candidate ID
      const allCandidates = await election.getAllCandidates();
      const nota = allCandidates.find(c => c.isNOTA && c.constituencyId === 1n);
      await expect(
        election.connect(voter1).castVote(nota.id)
      ).to.not.be.reverted;
    });
  });

  // ── Results Test ─────────────────────────────────────────────────────────

  describe("Transparent Results (EVM Opacity Fix)", () => {
    it("Should count votes accurately and provide verifiable results", async () => {
      await election.startVoting(3600);
      await election.connect(voter1).castVote(0); // Vote for candidate 0
      await election.connect(voter2).castVote(0); // Vote for candidate 0
      await election.connect(voter3).castVote(1); // Vote for candidate 1

      const results = await election.getConstituencyResults(1);
      // First result should be candidate 0 with 2 votes
      expect(results[0].voteCount).to.equal(2n);
      expect(results[1].voteCount).to.equal(1n);

      const status = await election.getElectionStatus();
      expect(status.totalVotes).to.equal(3n);
    });
  });

  // ── Timing Tests ─────────────────────────────────────────────────────────

  describe("Time-Locked Voting (Booth Capturing Prevention)", () => {
    it("Should reject votes after voting period ends", async () => {
      await election.startVoting(60); // 60 seconds
      await time.increase(61);        // fast-forward past end
      await expect(
        election.connect(voter1).castVote(0)
      ).to.be.revertedWith("Voting period has ended");
    });
  });
});
