require("dotenv").config();
const { ethers } = require("ethers");
const { Client, GatewayIntentBits } = require("discord.js");

// ─── KONFIGURASI ────────────────────────────────────────────
const CONFIG = {
  evmRpcEndpoint: "https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com",
  lcdEndpoint: "https://lcd.uno.sentry.testnet.v3.kiivalidator.com",
  faucetUrl:   "https://explorer.kiichain.io/faucet", // URL Website Faucet

  chainId:     1336,
  chainName:   "KiiChain Testnet Oro",
  
  // Data dari .env
  privateKey:           process.env.KIICHAIN_PRIVATE_KEY || "",
  discordBotToken:      process.env.DISCORD_BOT_TOKEN    || "",
  discordFaucetChannel: process.env.DISCORD_FAUCET_CHANNEL_ID || "",
};

const TARGET_VALIDATORS = [
  "KiiPaladin", "KiiMidas", "AnonID.TOP", "GombezzZ",
  "MIPEnode", "MaouamNodelab", "LuckyStar", "SpaceStake",
];

const STAKING_PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000800";
const STAKING_ABI = [
  "function delegate(string memory validatorAddress) payable returns (bool success)",
];

// ─── HELPERS ─────────────────────────────────────────────────
function section(title) {
  console.log("\n" + "═".repeat(62));
  console.log(`  ${title}`);
  console.log("═".repeat(62));
}

function getProvider() { return new ethers.JsonRpcProvider(CONFIG.evmRpcEndpoint); }

function getWallet(provider) {
  const pk = CONFIG.privateKey.trim();
  return new ethers.Wallet(pk.startsWith("0x") ? pk : "0x" + pk, provider);
}

// ─── 1. OTOMATIS KLAIM FAUCET WEBSITE ────────────────────────
async function claimFaucetWebsite(address) {
  section("🌐 Mendaki Faucet Website");
  console.log(`  Target  : ${CONFIG.faucetUrl}`);
  console.log(`  Address : ${address}`);

  try {
    const response = await fetch(CONFIG.faucetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": "https://explorer.kiichain.io",
        "Referer": "https://explorer.kiichain.io/faucet",
      },
      body: JSON.stringify({ address: address }),
    });

    const result = await response.text();
    
    if (response.ok) {
      console.log(`  ✅ Berhasil! Respon: ${result}`);
    } else if (response.status === 429) {
      console.log(`  ⏳ Terlalu banyak permintaan (Rate Limit). Coba lagi nanti.`);
    } else {
      console.log(`  ⚠️ Status: ${response.status} - ${result}`);
    }
  } catch (err) {
    console.log(`  ❌ Gagal klaim website: ${err.message}`);
  }
}

// ─── 2. CLAIM FAUCET VIA DISCORD ────────────────────────────────
async function claimFaucetDiscord(address) {
  section("🤖 Claim Faucet via Discord");
  if (!CONFIG.discordBotToken) return console.log("  Skip: Token Discord tidak ada.");

  const faucetMessage = `$request ${address}`;
  const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      discordClient.destroy();
      console.log("  ❌ Timeout: Bot Discord tidak merespon.");
      resolve(false);
    }, 20000);

    discordClient.once("ready", async () => {
      try {
        const channel = await discordClient.channels.fetch(CONFIG.discordFaucetChannel);
        if (channel?.isTextBased()) {
          await channel.send(faucetMessage);
          console.log(`  ✅ Pesan "$request" terkirim.`);
        }
        clearTimeout(timeout);
        discordClient.destroy();
        resolve(true);
      } catch (err) {
        console.log(`  ❌ Error Discord: ${err.message}`);
        discordClient.destroy();
        resolve(false);
      }
    });
    discordClient.login(CONFIG.discordBotToken).catch(() => resolve(false));
  });
}

// ─── 3. RESOLVE VALIDATOR (SEMUA STATUS) ──────────────────────
async function resolveTargetValidators() {
  section("🔍 Mencari Validator (Tanpa Filter Status)");
  try {
    const res = await fetch(`${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/validators?pagination.limit=300`);
    const data = await res.json();
    const allValidators = data.validators || [];

    const resolved = [];
    for (const name of TARGET_VALIDATORS) {
      const match = allValidators.find(v => v.description.moniker.trim().toLowerCase() === name.toLowerCase());
      if (match) {
        console.log(`  ✅ ${name} [${match.status.replace("BOND_STATUS_", "")}] -> ${match.operator_address}`);
        resolved.push({ moniker: name, address: match.operator_address });
      }
    }
    return resolved;
  } catch (err) {
    console.log("  ❌ Gagal mengambil data validator.");
    return [];
  }
}

// ─── MAIN ────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀 KiiChain Auto-Tool: Faucet & Staking");
  
  try {
    const provider = getProvider();
    const wallet = getWallet(provider);

    // Langkah 1: Klaim Faucet Website
    await claimFaucetWebsite(wallet.address);

    // Langkah 2: Klaim Faucet Discord[cite: 1]
    await claimFaucetDiscord(wallet.address);

    // Langkah 3: Contoh Delegasi (Uncomment untuk mengaktifkan)
    // const targets = await resolveTargetValidators();
    // if (targets.length > 0) {
    //   console.log("\n  Siap melakukan delegasi...");
    // }

    console.log("\n✅ Selesai!\n");
  } catch (err) {
    console.error("\n❌ Error Utama:", err.message);
  }
}

main();
