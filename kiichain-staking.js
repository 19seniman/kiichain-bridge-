require("dotenv").config();
const { ethers } = require("ethers");
const { Client, GatewayIntentBits } = require("discord.js");
const readline = require("readline");

const CONFIG = {
  evmRpcEndpoint: "https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com",
  lcdEndpoint: "https://lcd.uno.sentry.testnet.v3.kiivalidator.com",
  faucetUrl:   "https://explorer.kiichain.io/faucet",
  chainId:     1336,
  privateKey:           process.env.KIICHAIN_PRIVATE_KEY || "",
  discordBotToken:      process.env.DISCORD_BOT_TOKEN    || "",
  discordFaucetChannel: process.env.DISCORD_FAUCET_CHANNEL_ID || "",
};

const TARGET_VALIDATORS = [
  "KiiPaladin", "KiiMidas", "AnonID.TOP", "GombezzZ",
  "MIPEnode", "MaouamNodelab", "LuckyStar", "SpaceStake",
];

const STAKING_PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000800";

// ABI diperbarui untuk memastikan kompatibilitas selector method
const STAKING_ABI = [
  "function delegate(string validatorAddress) payable returns (bool)"
];

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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function askQuestion(query) { return new Promise(resolve => rl.question(query, resolve)); }

async function claimFaucetWebsite(address) {
  section("🌐 Request Faucet Website");
  try {
    const response = await fetch(CONFIG.faucetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: address }),
    });
    console.log(response.ok ? `  ✅ Berhasil!` : `  ⚠️ Status: ${response.status}`);
  } catch (err) { console.log(`  ❌ Gagal: ${err.message}`); }
}

async function claimFaucetDiscord(address) {
  section("🤖 Claim Faucet Discord");
  if (!CONFIG.discordBotToken) return;
  const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { discordClient.destroy(); resolve(false); }, 20000);
    discordClient.once("ready", async () => {
      try {
        const channel = await discordClient.channels.fetch(CONFIG.discordFaucetChannel);
        if (channel?.isTextBased()) await channel.send(`$request ${address}`);
        console.log(`  ✅ Pesan terkirim.`);
        clearTimeout(timeout);
        discordClient.destroy();
        resolve(true);
      } catch (err) { discordClient.destroy(); resolve(false); }
    });
    discordClient.login(CONFIG.discordBotToken).catch(() => resolve(false));
  });
}

async function resolveTargetValidators() {
  section("🔍 Mencari Validator");
  try {
    const res = await fetch(`${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/validators?pagination.limit=300`);
    const data = await res.json();
    const allValidators = data.validators || [];
    const resolved = [];
    for (const name of TARGET_VALIDATORS) {
      const match = allValidators.find(v => v.description.moniker.trim().toLowerCase() === name.toLowerCase());
      if (match) resolved.push({ moniker: name, address: match.operator_address, status: match.status.replace("BOND_STATUS_", "") });
    }
    return resolved;
  } catch (err) { return []; }
}

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
      
      // Menambahkan gasLimit manual untuk menghindari error estimateGas
      const tx = await stakingContract.delegate(t.address, { 
        value: amountWei,
        gasLimit: 300000 
      });
      
      console.log(`  Tx: ${tx.hash}`);
      await tx.wait();
      console.log(`  ✅ Berhasil!`);
    } catch (err) {
      console.log(`  ❌ Gagal: ${err.shortMessage || err.message}`);
    }
  }
}

async function main() {
  console.log("\n🚀 KiiChain Auto-Tool: Perbaikan Delegate");
  try {
    const provider = getProvider();
    const wallet = getWallet(provider);
    console.log(`  Wallet : ${wallet.address}`);

    await claimFaucetWebsite(wallet.address);
    await claimFaucetDiscord(wallet.address);

    section("🎮 MENU STAKING");
    console.log(" 1. Staking 0.01 KII per Validator");
    console.log(" 2. Staking 0.1 KII per Validator");
    console.log(" 3. Lewati");

    const choice = await askQuestion("\n Pilih (1/2/3): ");
    if (choice === "1") await delegateToAll(0.01);
    else if (choice === "2") await delegateToAll(0.1);
    else console.log("\n  Dilewati.");

    console.log("\n✅ Selesai!\n");
  } catch (err) { console.error("\n❌ Error:", err.message); }
  finally { rl.close(); }
}

main();
