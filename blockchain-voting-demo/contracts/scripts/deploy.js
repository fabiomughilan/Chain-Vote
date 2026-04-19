const hre = require("hardhat");

/**
 * Deploy IndianElection.sol to Sonic EVM
 * Seeds 5 constituencies (Lok Sabha style) with real-world Indian party data.
 * NOTA is automatically added to every constituency (ECI mandate, SC 2013).
 */
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🇮🇳 Deploying Bharat Chain Vote contracts...");
  console.log("   Deployer:", deployer.address);
  console.log("   Network:", hre.network.name);

  // ── Deploy IndianElection ─────────────────────────────────────────────────
  const IndianElection = await hre.ethers.getContractFactory("IndianElection");
  const election = await IndianElection.deploy(
    "Lok Sabha General Election - Blockchain Demo",
    5 // 5 constituencies
  );
  await election.waitForDeployment();

  const contractAddress = await election.getAddress();
  console.log("\n✅ IndianElection deployed at:", contractAddress);
  console.log("   View on SonicScan: https://testnet.sonicscan.org/address/" + contractAddress);

  // ── Seed Candidates ───────────────────────────────────────────────────────
  const parties = [
    { name: "Aarav Kumar",  party: "Bharatiya Lok Dal",     symbol: "🌸", constituency: 1 },
    { name: "Priya Sharma", party: "Indian National Front",  symbol: "✋", constituency: 1 },
    { name: "Rajan Mehta",  party: "Progressive Alliance",   symbol: "🌾", constituency: 1 },
    { name: "Sunita Devi",  party: "Republic Party",         symbol: "⚡", constituency: 1 },

    { name: "Vikram Singh", party: "Bharatiya Lok Dal",     symbol: "🌸", constituency: 2 },
    { name: "Meena Patel",  party: "Indian National Front",  symbol: "✋", constituency: 2 },
    { name: "Arjun Rao",   party: "Progressive Alliance",   symbol: "🌾", constituency: 2 },
    { name: "Kavita Nair", party: "Republic Party",         symbol: "⚡", constituency: 2 },

    { name: "Dhruv Joshi",  party: "Bharatiya Lok Dal",     symbol: "🌸", constituency: 3 },
    { name: "Lakshmi Iyer", party: "Indian National Front",  symbol: "✋", constituency: 3 },
    { name: "Sanjay Gupta", party: "Progressive Alliance",   symbol: "🌾", constituency: 3 },
    { name: "Radha Pillai", party: "Republic Party",         symbol: "⚡", constituency: 3 },

    { name: "Anil Tiwari",  party: "Bharatiya Lok Dal",     symbol: "🌸", constituency: 4 },
    { name: "Jayanti Roy",  party: "Indian National Front",  symbol: "✋", constituency: 4 },
    { name: "Prakash Das",  party: "Progressive Alliance",   symbol: "🌾", constituency: 4 },
    { name: "Uma Bose",     party: "Republic Party",         symbol: "⚡", constituency: 4 },

    { name: "Kiran Reddy",  party: "Bharatiya Lok Dal",     symbol: "🌸", constituency: 5 },
    { name: "Vijay Menon",  party: "Indian National Front",  symbol: "✋", constituency: 5 },
    { name: "Sneha More",   party: "Progressive Alliance",   symbol: "🌾", constituency: 5 },
    { name: "Gopal Shah",   party: "Republic Party",         symbol: "⚡", constituency: 5 },
  ];

  console.log("\n📋 Registering candidates...");
  for (const p of parties) {
    const tx = await election.addCandidate(p.name, p.party, p.symbol, p.constituency, false);
    await tx.wait();
    console.log(`   ✅ [C${p.constituency}] ${p.symbol} ${p.name} (${p.party})`);
  }

  // ── Seed NOTA for each constituency (ECI mandate) ─────────────────────────
  console.log("\n🚫 Adding NOTA for all constituencies (ECI mandate)...");
  for (let c = 1; c <= 5; c++) {
    const tx = await election.addCandidate(
      "None of the Above",
      "NOTA",
      "🚫",
      c,
      true
    );
    await tx.wait();
    console.log(`   ✅ NOTA added to Constituency ${c}`);
  }

  // ── Start Voting (24 hours) ───────────────────────────────────────────────
  const VOTING_DURATION = 24 * 60 * 60; // 24 hours in seconds
  const tx = await election.startVoting(VOTING_DURATION);
  await tx.wait();
  console.log("\n🗳️ Voting phase started! Duration: 24 hours");

  // ── Output Summary ───────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE");
  console.log("═".repeat(60));
  console.log("CONTRACT_ADDRESS=" + contractAddress);
  console.log("NETWORK=sonicTestnet (Chain ID 14601)");
  console.log("SONICSCAN=https://testnet.sonicscan.org/address/" + contractAddress);
  console.log("═".repeat(60));
  console.log("\n👉 Copy CONTRACT_ADDRESS to backend/.env");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Deployment failed:", err);
    process.exit(1);
  });
