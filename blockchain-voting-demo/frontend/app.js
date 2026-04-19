/* ═══════════════════════════════════════════════════════════════
   BHARAT CHAIN VOTE — app.js
   Dual mode: DEMO (no wallet) + LIVE (MetaMask + Sonic EVM)
   ═══════════════════════════════════════════════════════════════ */

const API = "http://localhost:3001";

// ── App State ─────────────────────────────────────────────────────────────────
let appConfig       = null;
let appMode         = "demo";   // "demo" | "live"
let walletAddress   = null;
let walletConnected = false;
let contract        = null;
let provider        = null;

// Voter state
let currentVoterKey       = null;  // demo: session key | live: wallet address
let currentVoterData      = null;  // { constituencyId, hasVoted, ... }
let selectedCandidateId   = null;
let activeConstituency    = 1;
let activeResultsConstituency = 1;
let resultsChart          = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  await initApp();
  await Promise.all([
    loadConstituency(1),
    loadStatus(),
    loadExplorer(),
    loadResults(1),
  ]);
  setInterval(loadStatus, 10000);
  setInterval(loadExplorer, 15000);
});

async function initApp() {
  try {
    const res = await fetch(`${API}/config`);
    appConfig  = await res.json();
    appMode    = appConfig.mode;

    document.getElementById("mode-badge").textContent =
      appMode === "live" ? "🔗 Live — Sonic EVM" : "🎮 Demo Mode";
    document.getElementById("mode-badge").className =
      `mode-badge ${appMode}`;

    if (appMode === "live") {
      document.getElementById("register-live-note").classList.remove("hidden");
    }

    // Check if MetaMask is available
    if (typeof window.ethereum !== "undefined") {
      window.ethereum.on("accountsChanged", handleAccountsChanged);
      window.ethereum.on("chainChanged",    () => window.location.reload());
    }
  } catch (e) {
    console.warn("Backend not running — offline demo mode");
    appMode = "demo";
  }
}

// ── Status polling ────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const res = await fetch(`${API}/status`);
    const { phase, phaseLabel, totalVotes, voteEnd } = await res.json();

    document.getElementById("stat-votes").textContent = totalVotes || 0;
    document.getElementById("stat-phase").textContent = phaseLabel || "Voting Open";

    // Countdown
    if (voteEnd) {
      const remaining = voteEnd - Math.floor(Date.now() / 1000);
      if (remaining > 0) {
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
      }
    }
  } catch (_) {}
}

// ── Wallet Connection ─────────────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    showToast("MetaMask not found — running in Demo Mode", "info");
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    walletAddress  = accounts[0];
    walletConnected = true;

    // Switch to Sonic Testnet
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(chainId, 16) !== 14601) {
      document.getElementById("network-overlay").classList.remove("hidden");
      return;
    }

    await onWalletConnected();
  } catch (e) {
    showToast("Wallet connection cancelled", "error");
  }
}

async function onWalletConnected() {
  if (!walletAddress) return;

  const btn = document.getElementById("wallet-btn");
  btn.textContent = `✅ ${walletAddress.slice(0,6)}…${walletAddress.slice(-4)}`;
  btn.classList.add("connected");

  currentVoterKey = walletAddress;

  // Setup ethers contract if live mode
  if (appMode === "live" && appConfig?.contractAddress && window.ethers) {
    try {
      provider = new window.ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      contract = new window.ethers.Contract(
        appConfig.contractAddress,
        appConfig.abi,
        signer
      );
    } catch (e) {
      console.warn("Contract setup failed, falling back to demo");
    }
  }

  // Check on-chain voter registration
  await checkVoterStatus();
  showToast(`Connected: ${walletAddress.slice(0,6)}…${walletAddress.slice(-4)}`, "success");
}

function handleAccountsChanged(accounts) {
  if (accounts.length === 0) {
    walletConnected = false;
    walletAddress   = null;
    document.getElementById("wallet-btn").textContent = "🦊 Connect Wallet";
    document.getElementById("wallet-btn").classList.remove("connected");
  } else {
    walletAddress = accounts[0];
    onWalletConnected();
  }
}

async function addSonicNetwork() {
  try {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId:          "0x3919",   // 14601 in hex
        chainName:        "Sonic Testnet",
        nativeCurrency:   { name: "Sonic", symbol: "S", decimals: 18 },
        rpcUrls:          ["https://rpc.testnet.soniclabs.com"],
        blockExplorerUrls:["https://testnet.sonicscan.org"],
      }],
    });
    document.getElementById("network-overlay").classList.add("hidden");
    await onWalletConnected();
  } catch (e) {
    showToast("Failed to add Sonic Testnet: " + e.message, "error");
  }
}

// ── Voter Registration ────────────────────────────────────────────────────────
async function registerVoter() {
  const name     = document.getElementById("reg-name").value.trim();
  const aadhaar  = document.getElementById("reg-aadhaar").value.trim();
  const epic     = document.getElementById("reg-epic").value.trim().toUpperCase();
  const cid      = parseInt(document.getElementById("reg-constituency").value);

  if (!name || !aadhaar || !epic || !cid) {
    showStatus("reg-status", "Please fill in all fields", "error");
    return;
  }
  if (aadhaar.length !== 4 || !/^\d+$/.test(aadhaar)) {
    showStatus("reg-status", "Enter last 4 digits of Aadhaar (numbers only)", "error");
    return;
  }

  // Client-side hash commitment
  const aadhaarHash = await sha256Web(aadhaar);
  const epicHash    = await sha256Web(epic);

  // Show hash preview
  document.getElementById("reg-aadhaar-hash").textContent = aadhaarHash.slice(0, 20) + "…";
  document.getElementById("reg-epic-hash").textContent    = epicHash.slice(0, 20) + "…";
  document.getElementById("reg-hash-preview").classList.remove("hidden");

  showStatus("reg-status", "<span class='spin-inline'>⏳</span> Registering on blockchain…", "info");

  try {
    if (appMode === "live" && contract) {
      // Real on-chain registration
      const tx = await contract.selfRegister(
        "0x" + aadhaarHash,
        "0x" + epicHash,
        cid
      );
      showStatus("reg-status", `⛓️ Transaction submitted… ${tx.hash.slice(0,12)}…`, "info");
      await tx.wait();
      currentVoterKey = walletAddress;
    } else {
      // Demo mode
      const key = name + ":" + aadhaarHash.slice(0, 8);
      const res = await fetch(`${API}/demo/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voterKey: key, aadhaarLast4: aadhaar, epicCardNo: epic, constituencyId: cid,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showStatus("reg-status", data.error, "error"); return; }
      currentVoterKey = key;
    }

    // Store session
    sessionStorage.setItem("voterKey", currentVoterKey);
    sessionStorage.setItem("voterName", name);
    sessionStorage.setItem("voterConstituency", cid);

    await checkVoterStatus();
    showStatus("reg-status", "✅ Successfully registered! You can now cast your vote.", "success");
    selectConstituency(cid);

  } catch (e) {
    showStatus("reg-status", e.reason || e.message || "Registration failed", "error");
  }
}

async function checkVoterStatus() {
  const key = currentVoterKey || sessionStorage.getItem("voterKey");
  if (!key) return;
  currentVoterKey = key;

  try {
    let data;
    if (appMode === "live" && contract && key.startsWith("0x")) {
      const info = await contract.getVoterInfo(key);
      data = {
        isRegistered: info.isRegistered,
        constituencyId: Number(info.constituencyId),
        hasVoted: info.hasVoted,
      };
    } else {
      const res = await fetch(`${API}/demo/voter/${encodeURIComponent(key)}`);
      data = await res.json();
    }

    if (data.isRegistered) {
      currentVoterData = data;
      const name = sessionStorage.getItem("voterName") || formatAddress(key);
      const cnames = ["","Delhi Central","Mumbai North","Chennai South","Kolkata East","Bangalore Urban"];

      document.getElementById("voter-status-card").classList.remove("hidden");
      document.getElementById("voter-status-name").textContent = name;
      document.getElementById("voter-status-detail").textContent =
        `Constituency #${data.constituencyId} — ${cnames[data.constituencyId] || ""} | EPIC verified`;
      if (data.hasVoted) {
        document.getElementById("voter-voted-badge").classList.remove("hidden");
      }
      document.getElementById("vote-btn").disabled = data.hasVoted;
    }
  } catch (e) {
    console.warn("Voter status check failed:", e);
  }
}

async function metaMaskRegister() {
  const aadhaar  = document.getElementById("reg-aadhaar").value.trim();
  const epic     = document.getElementById("reg-epic").value.trim().toUpperCase();
  const cid      = parseInt(document.getElementById("reg-constituency").value);
  if (!aadhaar || !epic || !cid) {
    showToast("Fill in Aadhaar, EPIC, and constituency first", "error"); return;
  }
  if (!contract) { showToast("Connect MetaMask wallet first", "error"); return; }

  const aadhaarHash = await sha256Web(aadhaar);
  const epicHash    = await sha256Web(epic);
  try {
    const tx = await contract.selfRegister("0x" + aadhaarHash, "0x" + epicHash, cid);
    showToast("Transaction submitted! Waiting…", "info");
    await tx.wait();
    showToast("✅ Registered on Sonic EVM!", "success");
    await checkVoterStatus();
  } catch (e) {
    showToast(e.reason || e.message, "error");
  }
}

// ── Constituency & Candidates ─────────────────────────────────────────────────
async function selectConstituency(cid) {
  activeConstituency  = cid;
  selectedCandidateId = null;
  document.querySelectorAll(".ctab").forEach(t => {
    t.classList.toggle("active", parseInt(t.dataset.cid) === cid);
  });
  document.getElementById("selected-info").classList.add("hidden");
  document.getElementById("vote-btn").disabled = true;
  await loadConstituency(cid);
}

async function loadConstituency(cid) {
  const grid = document.getElementById("candidates-grid");
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--mid-grey);padding:2rem"><span class="spin-inline">⏳</span> Loading candidates…</div>`;

  try {
    const res = await fetch(`${API}/candidates/${cid}`);
    const { candidates } = await res.json();
    renderCandidates(candidates);
  } catch (e) {
    grid.innerHTML = `<div style="color:var(--saffron);padding:1rem">Could not load candidates. Is the backend running?</div>`;
  }
}

function renderCandidates(candidates) {
  const grid = document.getElementById("candidates-grid");
  grid.innerHTML = "";
  candidates.forEach(c => {
    const card = document.createElement("div");
    card.className = `candidate-card${c.isNOTA ? " nota" : ""}`;
    card.dataset.id = c.id;
    card.onclick = () => selectCandidate(c);
    card.innerHTML = `
      <div class="candidate-symbol">${c.partySymbol}</div>
      <div class="candidate-name">${c.name}</div>
      <div class="candidate-party">${c.partyName}</div>
      <div class="candidate-badge ${c.isNOTA ? "nota-badge" : ""}">
        ${c.isNOTA ? "🚫 NOTA (ECI Mandate)" : "Candidate #" + c.id}
      </div>
    `;
    grid.appendChild(card);
  });
}

function selectCandidate(c) {
  if (!currentVoterData?.isRegistered) {
    showToast("Please register first before voting", "error");
    document.getElementById("register-section").scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (currentVoterData?.hasVoted) {
    showToast("You have already cast your vote", "error");
    return;
  }
  if (currentVoterData?.constituencyId !== c.constituencyId) {
    showToast("This candidate is not in your constituency", "error");
    return;
  }

  document.querySelectorAll(".candidate-card").forEach(el => el.classList.remove("selected"));
  document.querySelector(`[data-id="${c.id}"]`)?.classList.add("selected");

  selectedCandidateId = c.id;
  document.getElementById("selected-name").textContent  = c.name;
  document.getElementById("selected-party").textContent = `${c.partySymbol} ${c.partyName}`;
  document.getElementById("selected-info").classList.remove("hidden");
  document.getElementById("vote-btn").disabled = false;
}

// ── Vote Submission (Now with Gasless Relay!) ───────────────────────────────
async function submitVote() {
  if (selectedCandidateId === null) { showToast("Select a candidate first", "error"); return; }
  if (!currentVoterData?.isRegistered) { showToast("Register before voting", "error"); return; }
  if (currentVoterData?.hasVoted)     { showToast("You have already voted", "error"); return; }

  const btn = document.getElementById("vote-btn");
  btn.disabled   = true;
  btn.textContent = "⏳ Signing Vote Intent...";
  showStatus("vote-status", "<span class='spin-inline'>🛡️</span> Preparing cryptographic signature...", "info");

  try {
    let voteData;

    if (appMode === "live" && contract && walletAddress) {
      // ─── GASLESS FLOW (EIP-712) ───────────────────────────────────────────
      const provider = new window.ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      
      // 1. Fetch Nonce from backend
      const nres = await fetch(`${API}/nonce/${walletAddress}`);
      const { nonce } = await nres.json();

      // 2. Define EIP-712 Domain & Types
      const domain = {
        name:              appConfig.electionName || "Bharat Chain Vote",
        version:           "1",
        chainId:           appConfig.network.chainId,
        verifyingContract: appConfig.contractAddress
      };

      const types = {
        Vote: [
          { name: "voter",       type: "address" },
          { name: "candidateId", type: "uint256" },
          { name: "nonce",       type: "uint256" }
        ]
      };

      const message = {
        voter:       walletAddress,
        candidateId: selectedCandidateId,
        nonce:       nonce
      };

      showStatus("vote-status", "✍️ Please sign the vote intent in MetaMask (Free)", "info");

      // 3. User Signs intent (Zero Gas)
      const signature = await signer.signTypedData(domain, types, message);
      
      showStatus("vote-status", "📡 Relaying signature to government backend...", "info");
      btn.textContent = "⏳ Relaying to Blockchain...";

      // 4. Relay to Backend
      const res = await fetch(`${API}/vote/relayed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voter: walletAddress,
          candidateId: selectedCandidateId,
          signature
        }),
      });

      voteData = await res.json();
      if (!res.ok) throw new Error(voteData.error || "Relay failed");

    } else {
      // ─── DEMO MODE VOTE ────────────────────────────────────────────────────
      const res = await fetch(`${API}/demo/vote/relayed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voter: currentVoterKey, candidateId: selectedCandidateId }),
      });
      voteData = await res.json();
      if (!res.ok) { showStatus("vote-status", voteData.error, "error"); btn.textContent = "🗳️ Submit Vote"; btn.disabled = false; return; }
    }

    // Update local state
    currentVoterData.hasVoted = true;
    document.getElementById("voter-voted-badge").classList.remove("hidden");
    btn.textContent = "✅ Vote Cast!";

    // Show VVPAT receipt
    showVVPAT({
      ...voteData,
      candidateName: document.querySelector(`[data-id="${selectedCandidateId}"] .candidate-name`)?.textContent,
      partyName:     document.querySelector(`[data-id="${selectedCandidateId}"] .candidate-party`)?.textContent,
    });
    
    showStatus("vote-status", "✅ Successfully recorded via Gasless Relay!", "success");

    // Refresh explorer + results
    setTimeout(() => { loadExplorer(); loadResults(activeResultsConstituency); loadStatus(); }, 1500);

  } catch (e) {
    console.error("Vote error:", e);
    showStatus("vote-status", e.message || "Vote failed", "error");
    btn.textContent = "🗳️ Submit Vote";
    btn.disabled = false;
  }
}

// ── VVPAT Receipt ─────────────────────────────────────────────────────────────
function showVVPAT(data) {
  const cnames = ["","Delhi Central","Mumbai North","Chennai South","Kolkata East","Bangalore Urban"];
  const cid = data.constituencyId || currentVoterData?.constituencyId;

  document.getElementById("vvpat-candidate").textContent    = data.candidateName || data.candidate?.name || "—";
  document.getElementById("vvpat-party").textContent        = data.partyName || data.candidate?.partyName || "—";
  document.getElementById("vvpat-constituency").textContent = `${cid} — ${cnames[cid] || ""}`;
  document.getElementById("vvpat-tx").textContent           = (data.txHash || "Demo-" + data.blockNumber || "—");
  document.getElementById("vvpat-hash").textContent         = (data.vvpatHash || "—");
  document.getElementById("vvpat-time").textContent         = new Date().toLocaleString("en-IN");

  if (data.isLive && data.txHash) {
    const link = document.getElementById("vvpat-sonicscan");
    link.href = `https://testnet.sonicscan.org/tx/${data.txHash}`;
    document.getElementById("vvpat-explorer-link").classList.remove("hidden");
  }

  document.getElementById("vvpat-overlay").classList.remove("hidden");
}

function closeVVPAT() {
  document.getElementById("vvpat-overlay").classList.add("hidden");
}

// ── Blockchain Explorer ───────────────────────────────────────────────────────
async function loadExplorer() {
  try {
    const res    = await fetch(`${API}/events`);
    const { events, isLive } = await res.json();

    document.getElementById("explorer-count").textContent = `${events.length} votes`;
    document.getElementById("explorer-mode").textContent  = isLive ? "🔗 Sonic EVM" : "🎮 Demo chain";

    const container = document.getElementById("explorer-chain");
    if (!events.length) {
      container.innerHTML = `<div style="text-align:center;color:var(--mid-grey);padding:2rem">No votes recorded yet. Cast the first vote!</div>`;
      return;
    }
    const cnames = ["","Delhi Central","Mumbai North","Chennai South","Kolkata East","Bangalore Urban"];
    container.innerHTML = events.slice(0, 10).map(e => `
      <div class="chain-block">
        <div class="chain-block-header">
          <span class="chain-block-number">Block #${e.blockNumber}</span>
          <span class="chain-block-time">${new Date(e.timestamp * 1000 || e.timestamp).toLocaleString("en-IN")}</span>
        </div>
        <div class="chain-block-body">
          <div class="chain-field"><span class="label">Candidate</span><span class="value">${e.candidateName || "Candidate #" + e.candidateId} ${e.partySymbol || ""}</span></div>
          <div class="chain-field"><span class="label">Party</span><span class="value">${e.partyName || "—"}</span></div>
          <div class="chain-field"><span class="label">Constituency</span><span class="value">${cnames[e.constituencyId] || e.constituencyId}</span></div>
          <div class="chain-field hash"><span class="label">Tx Hash</span><span class="value">${e.txHash}</span></div>
          <div class="chain-field hash"><span class="label">VVPAT</span><span class="value">${e.vvpatHash}</span></div>
          ${e.isLive || !e.isDemo
            ? `<a class="chain-link" href="https://testnet.sonicscan.org/tx/${e.txHash}" target="_blank">🔍 View on SonicScan →</a>`
            : ''}
        </div>
      </div>
    `).join("");
  } catch (_) {}
}

// ── Results ───────────────────────────────────────────────────────────────────
async function loadResults(cid) {
  activeResultsConstituency = cid;
  document.querySelectorAll(".rtab").forEach(t => {
    t.classList.toggle("active", parseInt(t.dataset.cid) === cid);
  });

  try {
    const res = await fetch(`${API}/results/${cid}`);
    const { results } = await res.json();
    renderResults(results);
  } catch (_) {}
}

function renderResults(results) {
  const board  = document.getElementById("results-board");
  const total  = results.reduce((s, r) => s + (r.voteCount || 0), 0);
  const winner = results[0];

  board.innerHTML = results.map((r, i) => {
    const pct = total > 0 ? Math.round(r.voteCount / total * 100) : 0;
    return `
      <div class="result-row ${i === 0 && r.voteCount > 0 ? "winner" : ""}">
        <div class="result-fill" style="width:${pct}%"></div>
        <div class="result-rank">${i + 1}</div>
        <div class="result-symbol">${r.partySymbol}</div>
        <div class="result-info">
          <div class="result-name">${r.name}</div>
          <div class="result-party">${r.partyName}</div>
        </div>
        <div class="result-count">${r.voteCount || 0}</div>
        ${i === 0 && r.voteCount > 0 ? '<div class="result-winner-badge">LEADING</div>' : ''}
      </div>`;
  }).join("");

  // Chart
  const ctx    = document.getElementById("results-chart");
  const labels = results.map(r => r.name);
  const data   = results.map(r => r.voteCount || 0);
  const bgs    = results.map((_, i) =>
    ["#FF9933","#138808","#1565C0","#9c27b0","#e53e3e"][i % 5]
  );

  if (resultsChart) resultsChart.destroy();
  resultsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ data, backgroundColor: bgs, borderRadius: 6, borderWidth: 0 }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.parsed.y} votes` } },
      },
      scales: {
        x: { ticks: { color: "#94a3b8", font: { size: 11 } }, grid: { color: "#30363d" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "#30363d" }, beginAtZero: true },
      },
    },
  });
}

// ── Audit ─────────────────────────────────────────────────────────────────────
async function auditVoter() {
  const key = document.getElementById("audit-key").value.trim();
  if (!key) { showToast("Enter a voter key or wallet address", "error"); return; }

  try {
    let data;
    if (appMode === "live" && key.startsWith("0x") && contract) {
      const info = await contract.getVVPATReceipt(key);
      data = { isRegistered: true, hasVoted: info.voted, vvpatHash: info.receiptHash, votedAt: Number(info.votedAt) };
    } else {
      const res = await fetch(`${API}/demo/voter/${encodeURIComponent(key)}`);
      data = await res.json();
    }

    const box = document.getElementById("audit-result");
    box.classList.remove("hidden");
    if (!data.isRegistered) {
      box.innerHTML = `<div style="color:var(--mid-grey)">No voter found with this key.</div>`;
      return;
    }
    box.innerHTML = `
      <h4>🔍 Voter Audit Report</h4>
      <div class="audit-field"><span>Status</span><span>${data.isRegistered ? "✅ Registered" : "❌ Not registered"}</span></div>
      <div class="audit-field"><span>Constituency</span><span>${data.constituencyId || "—"}</span></div>
      <div class="audit-field"><span>Has Voted</span><span>${data.hasVoted ? "✅ Yes" : "❌ No"}</span></div>
      <div class="audit-field"><span>VVPAT Receipt</span><span>${data.vvpat || data.vvpatHash || "—"}</span></div>
      <div class="audit-field"><span>Voted At</span><span>${data.votedAt ? new Date(data.votedAt).toLocaleString("en-IN") : "—"}</span></div>
    `;
  } catch (e) {
    showToast("Audit failed: " + e.message, "error");
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function sha256Web(str) {
  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function showStatus(id, msg, type) {
  const el = document.getElementById(id);
  el.innerHTML   = msg;
  el.className   = `status-msg ${type}`;
  el.classList.remove("hidden");
}

function showToast(msg, type) {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position:fixed; bottom:1.5rem; right:1.5rem; z-index:99999;
    background: ${type==="error"?"#e53e3e":type==="success"?"#138808":"#FF9933"};
    color:white; padding:.8rem 1.2rem; border-radius:10px;
    font-size:.85rem; font-weight:600;
    animation: slideIn .3s ease; max-width:320px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function formatAddress(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0,6)}…${addr.slice(-4)}`;
}
