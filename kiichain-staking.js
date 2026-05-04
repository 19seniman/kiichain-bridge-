require("dotenv").config();
const { ethers } = require("ethers");
const { Client, GatewayIntentBits } = require("discord.js");
const readline = require("readline");

// ─── KONFIGURASI ────────────────────────────────────────────
const CONFIG = {
  evmRpcEndpoint: "https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com",
  lcdEndpoint: "https://lcd.uno.sentry.testnet.v3.kiivalidator.com",
  faucetUrl:   "https://explorer.kiichain.io/faucet",

  chainId:     1336,
  chainName:   "KiiChain Testnet Oro",
  
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

function getProvider() { 
    return new ethers.JsonRpcProvider(CONFIG.evmRpcEndpoint); 
}

function getWallet(provider) {
  const pk = CONFIG.privateKey.trim();
  const formattedPk = pk.startsWith("0x") ? pk : "0x" + pk;
  return new ethers.Wallet(formattedPk, provider);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// ─── 1. KLAIM FAUCET WEBSITE ─────────────────────────────────
async function claimFaucetWebsite(address) {
  section("🌐 Mengirim Request Faucet Website");
  try {
    const response = await fetch(CONFIG.faucetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://explorer.kiichain.io",
        "Referer": "https://explorer.kiichain.io/faucet",
      },
      body: JSON.stringify({ address: address }),
    });
    const result = await response.text();
    console.log(response.ok ? `  ✅ Berhasil!` : `  ⚠️ Status: ${response.status}`);
  } catch (err) {
    console.log(`  ❌ Gagal: ${err.message}`);
  }
}

// ─── 2. CLAIM FAUCET DISCORD ─────────────────────────────────
async function claimFaucetDiscord(address) {
  section("🤖 Claim Faucet via Discord");
  if (!CONFIG.discordBotToken) return console.log("  Skip: Token Discord tidak ada.");

  const faucetMessage = `$request ${address}`;
  const discordClient = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] 
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      discordClient.destroy();
      console.log("  ❌ Timeout Discord.");
      resolve(false);
    }, 20000);

    discordClient.once("ready", async () => {
      try {
        const channel = await discordClient.channels.fetch(CONFIG.discordFaucetChannel);
        if (channel && channel.isTextBased()) {
          await channel.send(faucetMessage);
          console.log(`  ✅ Pesan terkirim.`);
        }
        clearTimeout(timeout);
        discordClient.destroy();
        resolve(true);
      } catch (err) {
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
        resolved.push({ 
            moniker: name, 
            address: match.operator_address, 
            status: match.status.replace("BOND_STATUS_", "") 
        });
      }
    }
    return resolved;
  } catch (err) {
    console.log("  ❌ Gagal mengambil data validator.");
    return [];
  }
}

// ─── 4. DELEGATE KE SEMUA TARGET ──────────────────────────────
async function delegateToAll(amountPerValidator) {
  const targets = await resolveTargetValidators();
  const provider = getProvider();
  const wallet = getWallet(provider);
  const stakingContract = new ethers.Contract(STAKING_PRECOMPILE_ADDRESS, STAKING_ABI, wallet);
  
  const amountWei = ethers.parseEther(amountPerValidator.toString());
  section(`📤 Staking ${amountPerValidator} KII ke ${targets.length} Validator`);

  for (const t of targets) {
    try {
      console.log(`\n  Delegasi ke: ${t.moniker} (${t.status})`);
      const tx = await stakingContract.delegate(t.address, { value: amountWei });
      console.log(`  Tx: ${tx.hash}`);
      await tx.wait();
      console.log(`  ✅ Berhasil!`);
    } catch (err) {
      console.log(`  ❌ Gagal: ${err.message}`);
    }
  }
}

// ─── MAIN ────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀 KiiChain Auto-Tool: Faucet & Staking");
  
  try {
    const provider = getProvider();
    const wallet = getWallet(provider);
    console.log(`  Wallet : ${wallet.address}`);

    // Prosedur Faucet
    await claimFaucetWebsite(wallet.address);
    await claimFaucetDiscord(wallet.address);

    // Menu Pilihan Staking
    section("🎮 MENU STAKING");
    console.log(" 1. Staking 0.01 KII per Validator");
    console.log(" 2. Staking 0.1 KII per Validator");
    console.log(" 3. Lewati Staking");

    const choice = await askQuestion("\n Pilih menu (1/2/3): ");

    if (choice === "1") {
      await delegateToAll(0.01);
    } else if (choice === "2") {
      await delegateToAll(0.1);
    } else {
      console.log("\n  Proses staking dilewati.");
    }

    console.log("\n✅ Selesai!\n");
  } catch (err) {
    console.error("\n❌ Error:", err.message);
  } finally {
    rl.close();
  }
}

main();
