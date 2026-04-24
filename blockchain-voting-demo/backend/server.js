require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const crypto  = require("crypto");

// ── Try to load ethers ────────────────────────────────────────────────────────
let ethers;
try { ethers = require("ethers"); } catch (e) { ethers = null; }

const app = express();
app.use(cors());
app.use(express.json());

// ─── IndianElection ABI (Including Gasless Voting functions) ──────────────────
const ELECTION_ABI = [
  "function currentPhase() view returns (uint8)",
  "function electionName() view returns (string)",
  "function constituencyCount() view returns (uint8)",
  "function votingStartTime() view returns (uint256)",
  "function votingEndTime() view returns (uint256)",
  "function nonces(address voter) view returns (uint256)",
  "function getElectionStatus() view returns (uint8 phase, uint256 voteStart, uint256 voteEnd, uint256 currentTime, uint256 totalVotes)",
  "function getConstituencyCandidates(uint8 constituencyId) view returns (tuple(uint256 id, string name, string partyName, string partySymbol, uint8 constituencyId, uint256 voteCount, bool isNOTA, bool exists)[])",
  "function getAllCandidates() view returns (tuple(uint256 id, string name, string partyName, string partySymbol, uint8 constituencyId, uint256 voteCount, bool isNOTA, bool exists)[])",
  "function getConstituencyResults(uint8 constituencyId) view returns (tuple(uint256 id, string name, string partyName, string partySymbol, uint8 constituencyId, uint256 voteCount, bool isNOTA, bool exists)[])",
  "function getVoterInfo(address voterAddress) view returns (uint8 constituencyId, bool isRegistered, bool hasVoted, bytes32 vvpatReceiptHash)",
  "function getVVPATReceipt(address voterAddress) view returns (bytes32 receiptHash, bool voted, uint256 votedAt)",
  "function castVoteRelayed(address voter, uint256 candidateId, bytes signature) external",
  "event VoteCast(address indexed voter, uint256 indexed candidateId, uint8 constituencyId, bytes32 vvpatHash, uint256 timestamp)",
  "event VoterRegistered(address indexed voter, uint8 constituencyId, bytes32 aadhaarHash)",
  "event PhaseChanged(uint8 newPhase, uint256 timestamp)",
];

// ─── Connection to Sonic EVM ──────────────────────────────────────────────────
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const RPC_URL          = process.env.RPC_URL || "https://rpc.testnet.soniclabs.com";
const CHAIN_ID         = parseInt(process.env.CHAIN_ID || "14601");

let provider = null;
let contract = null;
let relayer  = null;
let isLiveMode = false;

if (ethers && CONTRACT_ADDRESS && CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    if (process.env.PRIVATE_KEY) {
      relayer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
      contract = new ethers.Contract(CONTRACT_ADDRESS, ELECTION_ABI, relayer);
      console.log("🚀 Relayer Wallet Active:", relayer.address);
    } else {
      contract = new ethers.Contract(CONTRACT_ADDRESS, ELECTION_ABI, provider);
    }
    isLiveMode = true;
    console.log("🔗 Connected to Sonic EVM:", RPC_URL);
  } catch (e) {
    console.warn("⚠️  Sonic Connection Warning:", e.message);
  }
}

// ─── OFFLINE MODE STATE ───────────────────────────────────────────────────────
const OFFLINE_CONSTITUENCIES = [
  { id: 1, name: "Delhi Central" }, { id: 2, name: "Mumbai North" },
  { id: 3, name: "Chennai South" }, { id: 4, name: "Kolkata East" },
  { id: 5, name: "Bangalore Urban" }
];

const OFFLINE_CANDIDATES = [
    { id: 0,  name: "Aarav Kumar",  partyName: "Bharatiya Lok Dal",   partySymbol: "🌸", constituencyId: 1, voteCount: 0, isNOTA: false },
    { id: 1,  name: "Priya Sharma", partyName: "Indian National Front", partySymbol: "✋", constituencyId: 1, voteCount: 0, isNOTA: false },
    { id: 2,  name: "Rajan Mehta",  partyName: "Progressive Alliance", partySymbol: "🌾", constituencyId: 1, voteCount: 0, isNOTA: false },
    { id: 3,  name: "Sunita Devi",  partyName: "Republic Party",      partySymbol: "⚡", constituencyId: 1, voteCount: 0, isNOTA: false },
    { id: 4,  name: "None of the Above", partyName: "NOTA",           partySymbol: "🚫", constituencyId: 1, voteCount: 0, isNOTA: true  },
    { id: 5,  name: "Vikram Singh", partyName: "Bharatiya Lok Dal",   partySymbol: "🌸", constituencyId: 2, voteCount: 0, isNOTA: false },
    { id: 6,  name: "Meena Patel",  partyName: "Indian National Front", partySymbol: "✋", constituencyId: 2, voteCount: 0, isNOTA: false },
    { id: 7,  name: "Arjun Rao",    partyName: "Progressive Alliance", partySymbol: "🌾", constituencyId: 2, voteCount: 0, isNOTA: false },
    { id: 8,  name: "Kavita Nair",  partyName: "Republic Party",      partySymbol: "⚡", constituencyId: 2, voteCount: 0, isNOTA: false },
    { id: 9,  name: "None of the Above", partyName: "NOTA",           partySymbol: "🚫", constituencyId: 2, voteCount: 0, isNOTA: true  },
    { id: 10, name: "Dhruv Joshi",  partyName: "Bharatiya Lok Dal",   partySymbol: "🌸", constituencyId: 3, voteCount: 0, isNOTA: false },
    { id: 11, name: "Lakshmi Iyer", partyName: "Indian National Front", partySymbol: "✋", constituencyId: 3, voteCount: 0, isNOTA: false },
    { id: 12, name: "Sanjay Gupta", partyName: "Progressive Alliance", partySymbol: "🌾", constituencyId: 3, voteCount: 0, isNOTA: false },
    { id: 13, name: "Radha Pillai", partyName: "Republic Party",      partySymbol: "⚡", constituencyId: 3, voteCount: 0, isNOTA: false },
    { id: 14, name: "None of the Above", partyName: "NOTA",           partySymbol: "🚫", constituencyId: 3, voteCount: 0, isNOTA: true  },
];

const demoVoters     = new Map();
const demoUsedHashes = new Set();
const demoVoteLog    = [];

function sha256Demo(data) {
  return crypto.createHash("sha256").update(String(data)).digest("hex");
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get("/config", (req, res) => {
  res.json({
    mode:            isLiveMode ? "live" : "offline",
    contractAddress: CONTRACT_ADDRESS || null,
    abi:             ELECTION_ABI,
    network: {
      chainId: 14601, name: "Sonic Testnet", rpcUrl: RPC_URL,
      explorerUrl: "https://testnet.sonicscan.org", currencySymbol: "S"
    },
    constituencies: OFFLINE_CONSTITUENCIES,
  });
});

app.get("/status", async (req, res) => {
  try {
    if (isLiveMode) {
      const status = await contract.getElectionStatus();
      return res.json({
        phase: Number(status.phase), phaseLabel: ["Registration", "Voting", "Counting", "Results"][Number(status.phase)],
        voteStart: Number(status.voteStart), voteEnd: Number(status.voteEnd), currentTime: Number(status.currentTime), totalVotes: Number(status.totalVotes)
      });
    }
    const totalVotes = OFFLINE_CANDIDATES.reduce((s, c) => s + c.voteCount, 0);
    res.json({ phase: 1, phaseLabel: "Voting", voteStart: 0, voteEnd: 0, currentTime: Date.now()/1000, totalVotes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/nonce/:voter", async (req, res) => {
  try {
    if (isLiveMode) {
      const nonce = await contract.nonces(req.params.voter);
      return res.json({ nonce: Number(nonce) });
    }
    const v = demoVoters.get(req.params.voter) || { nonce: 0 };
    res.json({ nonce: v.nonce || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/vote/relayed", async (req, res) => {
  if (!isLiveMode || !relayer) return res.status(400).json({ error: "Relayer not available" });
  const { voter, candidateId, signature } = req.body;
  try {
    const tx = await contract.castVoteRelayed(voter, candidateId, signature);
    const receipt = await tx.wait();
    const event = receipt.logs.map(log => {
      try { return contract.interface.parseLog(log); } catch(e) { return null; }
    }).find(e => e && e.name === "VoteCast");
    res.json({ success: true, txHash: tx.hash, vvpatHash: event?.args?.vvpatHash, candidateId, voter });
  } catch (e) { res.status(500).json({ error: e.reason || e.message }); }
});

app.get("/candidates/:cid", async (req, res) => {
  const cid = parseInt(req.params.cid);
  try {
    if (isLiveMode) {
      const raw = await contract.getConstituencyCandidates(cid);
      return res.json({ candidates: raw.map(c => ({
        id: Number(c.id), name: c.name, partyName: c.partyName, partySymbol: c.partySymbol, constituencyId: Number(c.constituencyId), voteCount: Number(c.voteCount), isNOTA: c.isNOTA
      }))});
    }
    res.json({ candidates: OFFLINE_CANDIDATES.filter(c => c.constituencyId === cid) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/results/:cid", async (req, res) => {
  const cid = parseInt(req.params.cid);
  try {
    if (isLiveMode) {
      const raw = await contract.getConstituencyResults(cid);
      return res.json({ results: raw.map(c => ({
        id: Number(c.id), name: c.name, partyName: c.partyName, partySymbol: c.partySymbol, voteCount: Number(c.voteCount), isNOTA: c.isNOTA
      }))});
    }
    res.json({ results: OFFLINE_CANDIDATES.filter(c => c.constituencyId === cid).sort((a,b) => b.voteCount - a.voteCount) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/results", async (req, res) => {
    try {
      const allResults = [];
      const count = isLiveMode ? Number(await contract.constituencyCount()) : 5;
      for (let c = 1; c <= count; c++) {
        let results;
        if (isLiveMode) {
          const raw = await contract.getConstituencyResults(c);
          results = raw.map(x => ({ id: Number(x.id), name: x.name, partyName: x.partyName, partySymbol: x.partySymbol, voteCount: Number(x.voteCount), isNOTA: x.isNOTA }));
        } else {
          results = OFFLINE_CANDIDATES.filter(x => x.constituencyId === c).sort((a, b) => b.voteCount - a.voteCount);
        }
        allResults.push({ constituencyId: c, results });
      }
      res.json({ allResults });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/events", async (req, res) => {
  try {
    if (isLiveMode) {
      const filter = contract.filters.VoteCast();
      const logs = await contract.queryFilter(filter, -1000);
      const events = logs.map(log => ({
        blockNumber: log.blockNumber, txHash: log.transactionHash, voter: log.args.voter,
        candidateId: Number(log.args.candidateId), constituencyId: Number(log.args.constituencyId),
        vvpatHash: log.args.vvpatHash, timestamp: Number(log.args.timestamp)
      })).reverse();
      return res.json({ events, isLive: true });
    }
    res.json({ config: { mode: isLiveMode ? "live" : "offline" }, events: demoVoteLog.slice().reverse(), isLive: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/demo/register", (req, res) => {
  const { voterKey, aadhaarLast4, epicCardNo, constituencyId } = req.body;
  const ah = sha256Demo(aadhaarLast4);
  const eh = sha256Demo(epicCardNo);
  if (demoVoters.has(voterKey) || demoUsedHashes.has(ah) || demoUsedHashes.has(eh)) return res.status(403).json({ error: "Already registered" });
  demoVoters.set(voterKey, { constituencyId: parseInt(constituencyId), hasVoted: false, nonce: 0 });
  demoUsedHashes.add(ah); demoUsedHashes.add(eh);
  res.json({ success: true });
});

app.get("/demo/voter/:key", (req, res) => {
  const v = demoVoters.get(req.params.key);
  if (!v) return res.json({ isRegistered: false });
  res.json({ isRegistered: true, ...v });
});

app.post("/demo/vote/relayed", (req, res) => {
    const { voter, candidateId } = req.body;
    const v = demoVoters.get(voter);
    if (!v || v.hasVoted) return res.status(403).json({ error: "Invalid voter or already voted" });
    const c = OFFLINE_CANDIDATES.find(x => x.id === parseInt(candidateId));
    if (!c) return res.status(404).json({ error: "Candidate not found" });
    
    const vvpat = "0x" + crypto.randomBytes(32).toString("hex");
    v.hasVoted = true; v.vvpat = vvpat; v.nonce++; c.voteCount++;
    const ev = { blockNumber: demoVoteLog.length + 100, timestamp: Date.now()/1000, voter, candidateId, vvpatHash: vvpat, txHash: "0xDEMO_" + crypto.randomBytes(8).toString("hex"), isDemo: true };
    demoVoteLog.push(ev);
    res.json(ev);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🇮🇳 Bharat Chain Vote Backend Unified`);
  console.log(`   URL: http://localhost:${PORT} | Mode: ${isLiveMode ? "LIVE" : "OFFLINE"}`);
});
