require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "a".repeat(64);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Sonic Testnet (Chain ID: 14601)
    sonicTestnet: {
      url: "https://rpc.testnet.soniclabs.com",
      chainId: 14601,
      accounts: [PRIVATE_KEY],
    },
    // Sonic Mainnet (Chain ID: 146)
    sonicMainnet: {
      url: "https://rpc.soniclabs.com",
      chainId: 146,
      accounts: [PRIVATE_KEY],
    },
    // Local Hardhat network for testing
    hardhat: {
      chainId: 31337,
    },
  },
  etherscan: {
    apiKey: {
      sonicTestnet: process.env.SONICSCAN_API_KEY || "placeholder",
    },
    customChains: [
      {
        network: "sonicTestnet",
        chainId: 14601,
        urls: {
          apiURL: "https://testnet.sonicscan.org/api",
          browserURL: "https://testnet.sonicscan.org",
        },
      },
    ],
  },
};
