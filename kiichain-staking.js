require("dotenv").config();
const { ethers } = require("ethers");
const { Client, GatewayIntentBits, Partials } = require("discord.js");

// ─── KONFIGURASI ────────────────────────────────────────────
const CONFIG = {
  // Endpoint KiiChain Testnet Oro — EVM (JSON-RPC)
  evmRpcEndpoint: "https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com",

  // Endpoint Cosmos LCD (untuk informasi validator & staking)
  lcdEndpoint: "https://lcd.uno.sentry.testnet.v3.kiivalidator.com",
  faucetUrl:   "https://explorer.kiichain.io/faucet",

  chainId:     1336,
  chainName:   "KiiChain Testnet Oro",
  symbol:      "KII",
  decimals:    18,

  cosmosDenom: "ukii",        // 1 KII = 1.000.000 ukii

  // Data dari file .env
  privateKey:           process.env.KIICHAIN_PRIVATE_KEY || "",
  discordBotToken:      process.env.DISCORD_BOT_TOKEN    || "",
  discordFaucetChannel: process.env.DISCORD_FAUCET_CHANNEL_ID || "",
};

// ─── 8 TARGET VALIDATOR ──────────────────────────────────────
const TARGET_VALIDATORS = [
  "KiiPaladin",
  "KiiMidas",
  "AnonID.TOP",
  "GombezzZ",
  "MIPEnode",
  "MaouamNodelab",
  "LuckyStar",
  "SpaceStake",
];

// ─── ABI STAKING PRECOMPILE (EVM) ────────────────────────────
const STAKING_PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000800";
const STAKING_ABI = [
  "function delegate(string memory validatorAddress) payable returns (bool success)",
  "function undelegate(string memory validatorAddress, uint256 amount) returns (bool success)",
  "function redelegate(string memory srcValidator, string memory dstValidator, uint256 amount) returns (bool success)",
  "function claimRewards(string memory validatorAddress) returns (bool success)",
  "function delegation(address delegatorAddress, string memory validatorAddress) view returns (uint256 shares, tuple(string denom, uint256 amount) balance)",
  "function delegationRewards(address delegatorAddress, string memory validatorAddress) view returns (tuple(string denom, uint256 amount)[] rewards)",
];

// ─── HELPERS ─────────────────────────────────────────────────
function formatKii(amountWei) {
  return parseFloat(ethers.formatEther(amountWei)).toFixed(6) + " KII";
}

function formatKiiFromUkii(amountUkii) {
  return (Number(amountUkii) / 1_000_000).toFixed(6) + " KII";
}

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
  const withPrefix = pk.startsWith("0x") ? pk : "0x" + pk;
  return new ethers.Wallet(withPrefix, provider);
}

// ─── FETCH ADDRESS VALIDATOR (DIPERBARUI: SEMUA STATUS) ──────
async function resolveTargetValidators() {
  section("🔍 Mencari Address 8 Validator Target (Semua Status)");

  // Menghapus filter status agar validator tidak aktif tetap terdeteksi[cite: 1]
  const res = await fetch(
    `${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/validators?pagination.limit=200`
  );
  const data = await res.json();
  const allValidators = data.validators || [];

  const resolved = [];
  for (const targetName of TARGET_VALIDATORS) {
    const match = allValidators.find(
      (v) => v.description.moniker.trim().toLowerCase() === targetName.trim().toLowerCase()
    );

    if (match) {
      const status = match.status.replace("BOND_STATUS_", "");
      console.log(`  ✅ ${targetName} [${status}] -> ${match.operator_address}`);
      resolved.push({
        moniker: targetName,
        address: match.operator_address,
        status:  status
      });
    } else {
      console.log(`  ⚠️  TIDAK DITEMUKAN: "${targetName}"`);
    }
  }
  return resolved;
}

// ─── CLAIM FAUCET VIA DISCORD (DIPERBARUI: FORMAT PESAN) ─────
async function claimFaucetDiscord(address) {
  section("🤖 Claim Faucet via Discord");

  if (!CONFIG.discordBotToken || !CONFIG.discordFaucetChannel) {
    console.log("  ⚠️  Gagal: Token Bot atau Channel ID Discord belum diisi di .env");
    return;
  }

  // Format pesan: $request 0x(alamat)[cite: 1]
  const faucetMessage = `$request ${address}`;
  console.log(`  Target Channel: ${CONFIG.discordFaucetChannel}`);
  console.log(`  Isi Pesan    : ${faucetMessage}`);

  const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      discordClient.destroy();
      console.log("  ❌ Timeout: Gagal mengirim pesan ke Discord.");
      resolve(false);
    }, 20000);

    discordClient.once("ready", async () => {
      try {
        const channel = await discordClient.channels.fetch(CONFIG.discordFaucetChannel);
        if (channel && channel.isTextBased()) {
          await channel.send(faucetMessage);
          console.log(`  ✅ Pesan terhasil dikirim!`);
        }
        clearTimeout(timeout);
        discordClient.destroy();
        resolve(true);
      } catch (err) {
        console.log(`  ❌ Gagal mengirim pesan: ${err.message}`);
        discordClient.destroy();
        resolve(false);
      }
    });

    discordClient.login(CONFIG.discordBotToken).catch(() => resolve(false));
  });
}

// ─── DELEGATE KE SEMUA TARGET (DIPERBARUI) ───────────────────
async function delegateToAll(totalKii) {
  section(`📤 Delegate Total ${totalKii} KII ke Validator Target`);

  const targets = await resolveTargetValidators();
  if (targets.length === 0) return;

  const provider = getProvider();
  const wallet = getWallet(provider);
  const stakingContract = new ethers.Contract(STAKING_PRECOMPILE_ADDRESS, STAKING_ABI, wallet);

  const amountPerValidator = totalKii / targets.length;
  const amountWei = ethers.parseEther(amountPerValidator.toFixed(18));

  for (const t of targets) {
    try {
      console.log(`\n  Memproses: ${t.moniker} (${t.status})`);
      const tx = await stakingContract.delegate(t.address, { value: amountWei });
      console.log(`  Tx Hash: ${tx.hash}`);
      await tx.wait();
      console.log(`  ✅ Delegasi Berhasil!`);
    } catch (err) {
      console.log(`  ❌ Gagal Delegasi: ${err.message}`);
    }
  }
}

// ─── MAIN EXECUTION ──────────────────────────────────────────
async function main() {
  console.log("\n🚀 KiiChain Staking & Faucet Script — Updated");
  
  try {
    const provider = getProvider();
    const wallet = getWallet(provider);
    const balance = await provider.getBalance(wallet.address);

    console.log(`  Wallet : ${wallet.address}`);
    console.log(`  Saldo  : ${formatKii(balance)}`);

    // 1. Jalankan Faucet Discord[cite: 1]
    await claimFaucetDiscord(wallet.address);

    // 2. Jalankan Delegasi ke 8 Validator[cite: 1]
    // Silakan ganti angka 8 di bawah ini dengan total KII yang ingin didelegasikan
    // await delegateToAll(8); 

    console.log("\n✅ Semua proses selesai!\n");
  } catch (err) {
    console.error("\n❌ Terjadi Kesalahan Utama:", err.message);
  }
}

main();
