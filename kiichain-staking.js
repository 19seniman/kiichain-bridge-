require("dotenv").config();
const { ethers } = require("ethers");
const { Client, GatewayIntentBits, Partials } = require("discord.js");

// ─── KONFIGURASI ────────────────────────────────────────────
const CONFIG = {
  // Endpoint KiiChain Testnet Oro — EVM (JSON-RPC)
  evmRpcEndpoint: "https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com",

  // Endpoint Cosmos LCD (dipakai untuk staking/validator info)
  lcdEndpoint: "https://lcd.uno.sentry.testnet.v3.kiivalidator.com",
  faucetUrl:   "https://explorer.kiichain.io/faucet",

  // Chain info EVM
  chainId:     1336,          // KiiChain Testnet Oro EVM Chain ID
  chainName:   "KiiChain Testnet Oro",
  symbol:      "KII",
  decimals:    18,            // EVM menggunakan 18 desimal

  // Cosmos info (untuk staking via LCD)
  cosmosDenom: "ukii",        // 1 KII = 1_000_000 ukii (untuk LCD staking)

  // Private key dari .env (hex, boleh dengan/tanpa "0x")
  privateKey: process.env.KIICHAIN_PRIVATE_KEY || "",

  // Validator tujuan staking (Cosmos bech32 format: kiivaloper1...)
  validatorAddress: "kiivaloper1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",

  // Discord config dari .env
  discordBotToken:      process.env.DISCORD_BOT_TOKEN         || "",
  discordFaucetChannel: process.env.DISCORD_FAUCET_CHANNEL_ID  || "",
};
// ────────────────────────────────────────────────────────────

// ─── ABI STAKING PRECOMPILE (EVM) ────────────────────────────
// KiiChain mengekspos modul staking Cosmos via Precompile Contract di EVM
// Address standar Cosmos EVM precompile untuk staking
const STAKING_PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000800";
const STAKING_ABI = [
  // Delegate
  "function delegate(string memory validatorAddress) payable returns (bool success)",
  // Undelegate
  "function undelegate(string memory validatorAddress, uint256 amount) returns (bool success)",
  // Redelegate
  "function redelegate(string memory srcValidator, string memory dstValidator, uint256 amount) returns (bool success)",
  // Claim Rewards
  "function claimRewards(string memory validatorAddress) returns (bool success)",
  // View: Delegation
  "function delegation(address delegatorAddress, string memory validatorAddress) view returns (uint256 shares, tuple(string denom, uint256 amount) balance)",
  // View: Delegator Rewards
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
  console.log("\n" + "═".repeat(58));
  console.log(`  ${title}`);
  console.log("═".repeat(58));
}

function parsePrivateKey(pkHex) {
  if (!pkHex || pkHex.trim() === "") {
    throw new Error(
      "Private key tidak ditemukan!\n" +
      "  Isi file .env: KIICHAIN_PRIVATE_KEY=0xABC123...\n"
    );
  }
  const clean = pkHex.trim();
  const withPrefix = clean.startsWith("0x") || clean.startsWith("0X")
    ? clean
    : "0x" + clean;
  if (withPrefix.length !== 66) { // "0x" + 64 hex chars
    throw new Error(`Private key harus 64 karakter hex, diterima: ${withPrefix.length - 2}`);
  }
  return withPrefix;
}

// ─── INISIALISASI WALLET & PROVIDER ──────────────────────────
function getProvider() {
  return new ethers.JsonRpcProvider(CONFIG.evmRpcEndpoint, {
    chainId: CONFIG.chainId,
    name:    CONFIG.chainName,
  });
}

function getWallet(provider) {
  const pk = parsePrivateKey(CONFIG.privateKey);
  return new ethers.Wallet(pk, provider);
}

// ─── 1. CEK SALDO WALLET (EVM) ───────────────────────────────
async function checkBalance() {
  section("💰 Saldo Wallet (EVM)");
  const provider = getProvider();
  const wallet   = getWallet(provider);

  const balance = await provider.getBalance(wallet.address);
  console.log(`  Address  : ${wallet.address}`);
  console.log(`  Saldo    : ${formatKii(balance)} (${balance.toString()} wei)`);
  console.log(`  Network  : ${CONFIG.chainName} (Chain ID: ${CONFIG.chainId})`);
  return balance;
}

// ─── 2. DAFTAR VALIDATOR AKTIF ───────────────────────────────
// Tetap menggunakan Cosmos LCD karena info validator hanya ada di sana
async function getValidators() {
  section("🏛️  Daftar Validator Aktif");
  const res = await fetch(
    `${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=20`
  );
  const data = await res.json();
  const validators = data.validators || [];
  validators.forEach((v, i) => {
    const commission = (parseFloat(v.commission.commission_rates.rate) * 100).toFixed(2);
    console.log(`\n  [${i + 1}] ${v.description.moniker}`);
    console.log(`       Address    : ${v.operator_address}`);
    console.log(`       Total Stake: ${formatKiiFromUkii(v.tokens)}`);
    console.log(`       Commission : ${commission}%`);
    console.log(`       Status     : ${v.status}`);
  });
  return validators;
}

// ─── 3. LIHAT DELEGASI AKTIF (via Cosmos LCD) ────────────────
async function getDelegations() {
  section("📋 Delegasi Aktif");
  // Perlu Cosmos address (bech32) — ambil dari LCD menggunakan EVM address
  const provider = getProvider();
  const wallet   = getWallet(provider);

  // Coba via LCD menggunakan EVM address (KiiChain mendukung mapping EVM ↔ Cosmos)
  let delegatorAddr = wallet.address;
  try {
    // Beberapa chain mendukung query delegasi via EVM address (0x format) di LCD
    const res = await fetch(
      `${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/delegations/${delegatorAddr}`
    );
    const data = await res.json();
    const delegations = data.delegation_responses || [];
    if (delegations.length === 0) {
      console.log("  Tidak ada delegasi aktif.");
      return delegations;
    }
    delegations.forEach((d) => {
      console.log(`\n  Validator : ${d.delegation.validator_address}`);
      console.log(`  Jumlah    : ${formatKiiFromUkii(d.balance.amount)}`);
    });
    return delegations;
  } catch (err) {
    console.log(`  ⚠️  Gagal mengambil delegasi: ${err.message}`);
    console.log(`  ℹ️  Gunakan EVM address: ${wallet.address}`);
    return [];
  }
}

// ─── 4. LIHAT REWARD BELUM DIKLAIM (via Cosmos LCD) ──────────
async function getRewards() {
  section("🎁 Reward Staking (Belum Diklaim)");
  const provider = getProvider();
  const wallet   = getWallet(provider);

  try {
    const res = await fetch(
      `${CONFIG.lcdEndpoint}/cosmos/distribution/v1beta1/delegators/${wallet.address}/rewards`
    );
    const data = await res.json();
    const rewards = data.rewards || [];
    if (rewards.length === 0) {
      console.log("  Belum ada reward.");
      return;
    }
    rewards.forEach((r) => {
      const ukiiReward = r.reward.find((t) => t.denom === CONFIG.cosmosDenom);
      if (ukiiReward) {
        console.log(`\n  Validator : ${r.validator_address}`);
        console.log(`  Reward    : ${formatKiiFromUkii(parseFloat(ukiiReward.amount).toFixed(0))}`);
      }
    });
    const total = data.total?.find((t) => t.denom === CONFIG.cosmosDenom);
    if (total) {
      console.log(`\n  ─── Total reward: ${formatKiiFromUkii(parseFloat(total.amount).toFixed(0))}`);
    }
  } catch (err) {
    console.log(`  ⚠️  Gagal mengambil reward: ${err.message}`);
  }
}

// ─── 5. DELEGATE TOKEN (via EVM Precompile) ──────────────────
async function delegate(amountKii) {
  section(`📤 Delegate ${amountKii} KII (EVM)`);
  const provider = getProvider();
  const wallet   = getWallet(provider);

  const stakingContract = new ethers.Contract(
    STAKING_PRECOMPILE_ADDRESS,
    STAKING_ABI,
    wallet
  );

  const amountWei = ethers.parseEther(amountKii.toString());
  console.log(`  From     : ${wallet.address}`);
  console.log(`  Validator: ${CONFIG.validatorAddress}`);
  console.log(`  Jumlah   : ${amountKii} KII`);
  console.log(`  Mengirim transaksi EVM...`);

  // Coba via precompile dulu, fallback ke transfer biasa jika precompile tidak tersedia
  try {
    const tx = await stakingContract.delegate(CONFIG.validatorAddress, {
      value: amountWei,
    });
    console.log(`  Tx Hash  : ${tx.hash}`);
    console.log(`  Menunggu konfirmasi...`);
    const receipt = await tx.wait();
    console.log(`  ✅ Berhasil delegate ${amountKii} KII!`);
    console.log(`  Block    : ${receipt.blockNumber}`);
    console.log(`  Gas Used : ${receipt.gasUsed.toString()}`);
    return receipt;
  } catch (err) {
    // Fallback: kirim langsung ke validator address jika precompile belum tersedia
    console.log(`  ⚠️  Precompile tidak tersedia, mencoba metode alternatif...`);
    console.log(`  Info: ${err.message}`);
    console.log(`  ℹ️  Pastikan validatorAddress sudah benar (kiivaloper1...)`);
    throw err;
  }
}

// ─── 6. UNDELEGATE TOKEN (via EVM Precompile) ────────────────
async function undelegate(amountKii) {
  section(`📥 Undelegate ${amountKii} KII (EVM)`);
  const provider = getProvider();
  const wallet   = getWallet(provider);

  const stakingContract = new ethers.Contract(
    STAKING_PRECOMPILE_ADDRESS,
    STAKING_ABI,
    wallet
  );

  const amountWei = ethers.parseEther(amountKii.toString());
  console.log(`  From     : ${wallet.address}`);
  console.log(`  Validator: ${CONFIG.validatorAddress}`);
  console.log(`  Jumlah   : ${amountKii} KII`);
  console.log(`  Mengirim transaksi EVM...`);

  const tx = await stakingContract.undelegate(CONFIG.validatorAddress, amountWei);
  console.log(`  Tx Hash  : ${tx.hash}`);
  console.log(`  Menunggu konfirmasi...`);
  const receipt = await tx.wait();
  console.log(`  ✅ Berhasil undelegate ${amountKii} KII!`);
  console.log(`  ⚠️  Token terkunci selama masa unbonding (~21 hari)`);
  console.log(`  Block    : ${receipt.blockNumber}`);
  return receipt;
}

// ─── 7. REDELEGATE TOKEN (via EVM Precompile) ────────────────
async function redelegate(amountKii, srcValidator, dstValidator) {
  section(`🔄 Redelegate ${amountKii} KII (EVM)`);
  const provider = getProvider();
  const wallet   = getWallet(provider);

  const stakingContract = new ethers.Contract(
    STAKING_PRECOMPILE_ADDRESS,
    STAKING_ABI,
    wallet
  );

  const amountWei = ethers.parseEther(amountKii.toString());
  console.log(`  From     : ${wallet.address}`);
  console.log(`  Dari     : ${srcValidator}`);
  console.log(`  Ke       : ${dstValidator}`);
  console.log(`  Jumlah   : ${amountKii} KII`);
  console.log(`  Mengirim transaksi EVM...`);

  const tx = await stakingContract.redelegate(srcValidator, dstValidator, amountWei);
  console.log(`  Tx Hash  : ${tx.hash}`);
  console.log(`  Menunggu konfirmasi...`);
  const receipt = await tx.wait();
  console.log(`  ✅ Berhasil redelegate ${amountKii} KII!`);
  console.log(`  ✅ Tidak ada masa unbonding — langsung aktif di validator baru`);
  console.log(`  Block    : ${receipt.blockNumber}`);
  return receipt;
}

// ─── 8. KLAIM REWARD (via EVM Precompile) ────────────────────
async function claimRewards() {
  section("💸 Klaim Semua Reward Staking (EVM)");
  const provider = getProvider();
  const wallet   = getWallet(provider);

  // Ambil list validator dari delegasi aktif
  let validatorAddresses = [];
  try {
    const res = await fetch(
      `${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/delegations/${wallet.address}`
    );
    const data = await res.json();
    validatorAddresses = (data.delegation_responses || []).map(
      (d) => d.delegation.validator_address
    );
  } catch {
    // Fallback ke validator di config jika LCD gagal
    validatorAddresses = [CONFIG.validatorAddress];
  }

  if (validatorAddresses.length === 0) {
    console.log("  Tidak ada delegasi aktif untuk diklaim rewardnya.");
    return;
  }

  const stakingContract = new ethers.Contract(
    STAKING_PRECOMPILE_ADDRESS,
    STAKING_ABI,
    wallet
  );

  let successCount = 0;
  for (const valAddr of validatorAddresses) {
    try {
      console.log(`\n  Klaim dari: ${valAddr}`);
      const tx = await stakingContract.claimRewards(valAddr);
      console.log(`  Tx Hash  : ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`  ✅ Berhasil! Block: ${receipt.blockNumber}`);
      successCount++;
    } catch (err) {
      console.log(`  ⚠️  Gagal klaim dari ${valAddr}: ${err.message}`);
    }
  }

  console.log(`\n  ─── Total berhasil: ${successCount}/${validatorAddresses.length} validator`);
}

// ─── 9. CLAIM FAUCET VIA WEBSITE ─────────────────────────────
async function claimFaucetWeb(address) {
  section("🌐 Claim Faucet via Website");
  console.log(`  Endpoint : ${CONFIG.faucetUrl}`);
  console.log(`  Address  : ${address}`);
  console.log(`  Mengirim request...`);

  try {
    const res = await fetch(CONFIG.faucetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept":       "application/json",
        "Origin":       "https://explorer.kiichain.io",
        "Referer":      "https://explorer.kiichain.io/faucet",
      },
      body: JSON.stringify({ address }),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (res.ok) {
      console.log(`  ✅ Faucet berhasil diklaim!`);
      if (data.txhash || data.tx_hash) {
        console.log(`  Tx Hash : ${data.txhash || data.tx_hash}`);
      }
      console.log(`  Respons :`, JSON.stringify(data, null, 4));
    } else {
      console.log(`  ⚠️  Status HTTP: ${res.status}`);
      if (res.status === 429) {
        console.log(`  ℹ️  Sudah claim dalam 24 jam terakhir. Coba lagi besok.`);
      } else {
        console.log(`  Respons :`, JSON.stringify(data, null, 4));
      }
    }
    return { status: res.status, data };
  } catch (err) {
    console.error(`  ❌ Gagal menghubungi faucet website: ${err.message}`);
    console.log(`  ℹ️  Coba klaim manual di: ${CONFIG.faucetUrl}`);
    throw err;
  }
}

// ─── 10. CLAIM FAUCET VIA DISCORD ────────────────────────────
async function claimFaucetDiscord(address) {
  section("🤖 Claim Faucet via Discord");

  if (!CONFIG.discordBotToken) {
    throw new Error(
      "DISCORD_BOT_TOKEN tidak ditemukan!\n" +
      "  1. Buka: https://discord.com/developers/applications\n" +
      "  2. New Application → Bot → Reset Token → copy token\n" +
      "  3. Undang bot ke server KiiChain (permission: Send Messages)\n" +
      "  4. Tambahkan ke .env: DISCORD_BOT_TOKEN=your_token"
    );
  }
  if (!CONFIG.discordFaucetChannel) {
    throw new Error(
      "DISCORD_FAUCET_CHANNEL_ID tidak ditemukan!\n" +
      "  1. Discord → Settings → Advanced → aktifkan Developer Mode\n" +
      "  2. Klik kanan channel #faucet → Copy Channel ID\n" +
      "  3. Tambahkan ke .env: DISCORD_FAUCET_CHANNEL_ID=123456789"
    );
  }

  const faucetMessage = `$request ${address}`;
  console.log(`  Channel ID   : ${CONFIG.discordFaucetChannel}`);
  console.log(`  Pesan        : ${faucetMessage}`);
  console.log(`  Menghubungkan bot ke Discord...`);

  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      discordClient.destroy();
      reject(new Error("Timeout: Bot Discord tidak bisa login dalam 30 detik."));
    }, 30_000);

    discordClient.once("ready", async () => {
      console.log(`  ✅ Bot login sebagai: ${discordClient.user.tag}`);
      try {
        const channel = await discordClient.channels.fetch(CONFIG.discordFaucetChannel);
        if (!channel) throw new Error(`Channel ID ${CONFIG.discordFaucetChannel} tidak ditemukan.`);
        if (!channel.isTextBased()) throw new Error(`Channel "${channel.name}" bukan text channel.`);

        console.log(`  📢 Mengirim ke #${channel.name}...`);
        const sentMsg = await channel.send(faucetMessage);
        console.log(`  ✅ Pesan berhasil dikirim!`);
        console.log(`  Message ID   : ${sentMsg.id}`);
        console.log(`  Isi Pesan    : ${sentMsg.content}`);
        console.log(`  ℹ️  Tunggu balasan bot faucet di #${channel.name}`);

        clearTimeout(timeout);
        discordClient.destroy();
        resolve({ messageId: sentMsg.id, content: sentMsg.content });
      } catch (err) {
        clearTimeout(timeout);
        discordClient.destroy();
        reject(err);
      }
    });

    discordClient.on("error", (err) => {
      clearTimeout(timeout);
      discordClient.destroy();
      reject(err);
    });

    discordClient.login(CONFIG.discordBotToken).catch((err) => {
      clearTimeout(timeout);
      reject(new Error(`Gagal login bot Discord: ${err.message}`));
    });
  });
}

// ─── MAIN ────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀 KiiChain Staking + Faucet Script (EVM Mode)");
  console.log(`   Network  : ${CONFIG.chainName} (Chain ID: ${CONFIG.chainId})`);
  console.log(`   RPC EVM  : ${CONFIG.evmRpcEndpoint}`);
  console.log(`   LCD      : ${CONFIG.lcdEndpoint}`);
  console.log(`   Faucet   : ${CONFIG.faucetUrl}`);

  try {
    const provider = getProvider();
    const wallet   = getWallet(provider);
    console.log(`\n   Wallet (EVM) : ${wallet.address}`);

    // ── READ-ONLY ──────────────────────────────────────────
    await checkBalance();
    await getValidators();
    await getDelegations();
    await getRewards();

    // ── FAUCET (uncomment salah satu atau keduanya) ────────

    // Klaim 2.500 KII via website explorer.kiichain.io/faucet
    // await claimFaucetWeb(wallet.address);

    // Klaim 2.500 KII via Discord (format: $request <address>)
    // await claimFaucetDiscord(wallet.address);

    // ── STAKING via EVM Precompile (uncomment untuk aktifkan) ─

    // Delegate 1 KII ke validator
    // await delegate(1);

    // Undelegate 0.5 KII dari validator
    // await undelegate(0.5);

    // Redelegate ke validator lain
    // const src = "kiivaloper1aaa...";
    // const dst = "kiivaloper1bbb...";
    // await redelegate(0.5, src, dst);

    // Klaim semua reward staking
    // await claimRewards();

    console.log("\n✅ Selesai!\n");
  } catch (err) {
    console.error("\n❌ Error:", err.message || err);
    process.exit(1);
  }
}

main();
