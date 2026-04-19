# 🇮🇳 Bharat Chain Vote — Gasless Blockchain Voting System

Bharat Chain Vote is a production-ready, decentralized voting platform designed for the Indian Election Commission (ECI). It eliminates the cost barrier for citizens by implementing a **Gasless Voting Architecture** on the **Sonic EVM**.

---

## 🚀 Key Features

- **Gasless Voting (Zero-Cost)**: Voters sign a cryptographic intent (EIP-712). The Government Relayer covers all network fees, ensuring democratic participation is free for every citizen.
- **Privacy-Preserving Identity**: Voter identities (Aadhaar/EPIC) are committed as `keccak256` hashes, ensuring anonymity while preventing impersonation.
- **EIP-712 Meta-Transactions**: Secure, off-chain signing flow that prevents replay attacks via uniquely managed nonces.
- **VVPAT Digital Receipt**: Every vote generates an on-chain verifiable receipt, allowing voters to audit their ballot without compromising secrecy.
- **Supreme Court Compliant**: Mandatory **NOTA** (None of the Above) candidate seeded in every constituency.
- **Phase-Locked Lifecycle**: Controlled election states (`Registration` → `Voting` → `Counting` → `Results`).

---

## 🛠️ Tech Stack

- **Smart Contracts**: Solidity 0.8.20, OpenZeppelin (ECDSA, EIP-712).
- **Blockchain**: Sonic EVM (Testnet: 14601).
- **Backend**: Node.js, Express, Ethers.js (Relayer Infrastructure).
- **Frontend**: Vanilla JS, Ethers.js (BrowserProvider), Chart.js (Results Visualization).

---

## ⚙️ Setup & Installation

### 1. Prerequisites
- Node.js (v18+)
- MetaMask Browser Extension

### 2. Backend Setup
1. Navigate to the backend folder:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file (see `.env.example`):
   ```env
   CONTRACT_ADDRESS=0x...
   PRIVATE_KEY=your_relayer_private_key
   RPC_URL=https://rpc.testnet.soniclabs.com
   ```
4. Start the server:
   ```bash
   npm start
   ```

### 3. Smart Contract Deployment (Optional)
If you want to deploy your own instance:
1. Navigate to the contracts folder:
   ```bash
   cd contracts
   npm install
   ```
2. Deploy to Sonic Testnet:
   ```bash
   npx hardhat run scripts/deploy.js --network sonicTestnet
   ```

### 4. Frontend Setup
The frontend is a static web app. 
1. Open `frontend/index.html` in your browser.
2. Ensure the backend is running on `http://localhost:3001`.

---

## 📖 Usage Guide

### Demo Mode (Simulated)
- No wallet required.
- Ideal for testing the UI and logic flow without blockchain interaction.
- Backend handles a simulated memory-chain.

### Live Mode (Blockchain)
1. **Connect Wallet**: Connect your MetaMask to the **Sonic Testnet**.
2. **Registration**: Fill in your details (Aadhaar last 4, EPIC No). Your identity will be hashed and stored on-chain.
3. **Voting**: Select your candidate. MetaMask will prompt you to **sign** the vote intent (Private Signature). 
4. **Relay**: The backend will detect your signature and submit it to the Sonic EVM using the relayer wallet.
5. **Audit**: View your VVPAT receipt and verify the transaction on the **SonicScan** explorer.

---

## 📁 Project Structure

```text
├── backend/            # Express Relayer Server
├── contracts/          # Hardhat Project & Solidity Contracts
├── frontend/           # Web Interface (HTML/CSS/JS)
├── ARCHITECTURE.md     # Technical Design & EIP-712 Flow
└── DOCUMENTATION.md    # High-level ECI Compliance Report
```

---

## ⚖️ License
This project was developed as a solution for secure, transparent, and accessible digital democracy in India.
