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
  chainId:     1336,
  chainName:   "KiiChain Testnet Oro",
  symbol:      "KII",
  decimals:    18,

  // Cosmos info (untuk staking via LCD)
  cosmosDenom: "ukii",        // 1 KII = 1_000_000 ukii

  // Private key dari .env (hex, boleh dengan/tanpa "0x")
  privateKey: process.env.KIICHAIN_PRIVATE_KEY || "",

  // Discord config dari .env
  discordBotToken:      process.env.DISCORD_BOT_TOKEN         || "",
  discordFaucetChannel: process.env.DISCORD_FAUCET_CHANNEL_ID  || "",
};

// ─── 8 TARGET VALIDATOR (sesuai gambar explorer.kiichain.io/staking) ────────
// Script akan otomatis mencari address kiivaloper1 berdasarkan nama ini dari LCD
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
// ────────────────────────────────────────────────────────────────────────────

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
  if (withPrefix.length !== 66) {
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

// ─── FETCH ADDRESS 8 VALIDATOR TARGET DARI LCD ───────────────
// Mencocokkan moniker name ke operator_address (kiivaloper1...)
async function resolveTargetValidators() {
  section("🔍 Mencari Address 8 Validator Target");

  const res = await fetch(
    `${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=50`
  );
  const data = await res.json();
  const allValidators = data.validators || [];

  const resolved = [];
  const notFound  = [];

  for (const targetName of TARGET_VALIDATORS) {
    // Cocokkan berdasarkan moniker (case-insensitive, trim)
    const match = allValidators.find(
      (v) => v.description.moniker.trim().toLowerCase() === targetName.trim().toLowerCase()
    );

    if (match) {
      const commission = (parseFloat(match.commission.commission_rates.rate) * 100).toFixed(2);
      console.log(`  ✅ ${targetName}`);
      console.log(`       Address    : ${match.operator_address}`);
      console.log(`       Total Stake: ${formatKiiFromUkii(match.tokens)}`);
      console.log(`       Commission : ${commission}%`);
      resolved.push({
        moniker:  match.description.moniker,
        address:  match.operator_address,
        tokens:   match.tokens,
        commission,
      });
    } else {
      console.log(`  ⚠️  TIDAK DITEMUKAN: "${targetName}"`);
      notFound.push(targetName);
    }
  }

  if (notFound.length > 0) {
    console.log(`\n  ⚠️  ${notFound.length} validator tidak ditemukan di jaringan:`);
    notFound.forEach((n) => console.log(`       - ${n}`));
    console.log(`\n  ℹ️  Validator yang tersedia:`);
    allValidators.forEach((v) => console.log(`       • ${v.description.moniker}`));
  }

  console.log(`\n  ─── Total: ${resolved.length}/${TARGET_VALIDATORS.length} validator siap didelegasikan`);
  return resolved;
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

// ─── 2. DAFTAR SEMUA VALIDATOR AKTIF ─────────────────────────
async function getValidators() {
  section("🏛️  Daftar Semua Validator Aktif");
  const res = await fetch(
    `${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=50`
  );
  const data = await res.json();
  const validators = data.validators || [];
  validators.forEach((v, i) => {
    const commission = (parseFloat(v.commission.commission_rates.rate) * 100).toFixed(2);
    const isTarget = TARGET_VALIDATORS.some(
      (t) => t.trim().toLowerCase() === v.description.moniker.trim().toLowerCase()
    );
    const tag = isTarget ? " ⭐ TARGET" : "";
    console.log(`\n  [${i + 1}] ${v.description.moniker}${tag}`);
    console.log(`       Address    : ${v.operator_address}`);
    console.log(`       Total Stake: ${formatKiiFromUkii(v.tokens)}`);
    console.log(`       Commission : ${commission}%`);
  });
  return validators;
}

// ─── 3. LIHAT DELEGASI AKTIF ──────────────────────────────────
async function getDelegations() {
  section("📋 Delegasi Aktif");
  const provider = getProvider();
  const wallet   = getWallet(provider);

  try {
    const res = await fetch(
      `${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/delegations/${wallet.address}`
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
    return [];
  }
}

// ─── 4. LIHAT REWARD BELUM DIKLAIM ───────────────────────────
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

// ─── 5. DELEGATE KE 8 VALIDATOR (dibagi rata) ────────────────
// totalKii akan dibagi merata ke semua validator target yang ditemukan
async function delegateToAll(totalKii) {
  section(`📤 Delegate ${totalKii} KII ke 8 Validator Target (EVM)`);

  // Resolve 8 validator target
  const targets = await resolveTargetValidators();
  if (targets.length === 0) {
    throw new Error("Tidak ada validator target yang ditemukan. Batalkan.");
  }

  const provider = getProvider();
  const wallet   = getWallet(provider);
  const balance  = await provider.getBalance(wallet.address);

  const amountPerValidator = totalKii / targets.length;
  const amountWeiPerValidator = ethers.parseEther(amountPerValidator.toFixed(18));
  const totalAmountWei = amountWeiPerValidator * BigInt(targets.length);

  console.log(`\n  From     : ${wallet.address}`);
  console.log(`  Saldo    : ${formatKii(balance)}`);
  console.log(`  Total    : ${totalKii} KII → dibagi ke ${targets.length} validator`);
  console.log(`  Per Val  : ${amountPerValidator.toFixed(6)} KII`);

  if (balance < totalAmountWei) {
    throw new Error(
      `Saldo tidak cukup!\n` +
      `  Butuh  : ${formatKii(totalAmountWei)}\n` +
      `  Punya  : ${formatKii(balance)}`
    );
  }

  const stakingContract = new ethers.Contract(
    STAKING_PRECOMPILE_ADDRESS,
    STAKING_ABI,
    wallet
  );

  let successCount = 0;
  const results = [];

  for (let i = 0; i < targets.length; i++) {
    const { moniker, address } = targets[i];
    console.log(`\n  [${i + 1}/${targets.length}] Delegate ke: ${moniker}`);
    console.log(`           Address : ${address}`);
    console.log(`           Jumlah  : ${amountPerValidator.toFixed(6)} KII`);

    try {
      const tx = await stakingContract.delegate(address, {
        value: amountWeiPerValidator,
      });
      console.log(`           Tx Hash : ${tx.hash}`);
      console.log(`           Menunggu konfirmasi...`);
      const receipt = await tx.wait();
      console.log(`           ✅ Berhasil! Block: ${receipt.blockNumber} | Gas: ${receipt.gasUsed.toString()}`);
      successCount++;
      results.push({ moniker, address, txHash: tx.hash, success: true });
    } catch (err) {
      console.log(`           ❌ Gagal: ${err.message}`);
      results.push({ moniker, address, error: err.message, success: false });
    }
  }

  section(`📊 Ringkasan Delegate`);
  console.log(`  Berhasil : ${successCount}/${targets.length} validator`);
  results.forEach((r, i) => {
    const status = r.success ? "✅" : "❌";
    console.log(`  ${status} [${i + 1}] ${r.moniker}`);
    if (r.txHash)  console.log(`           Tx: ${r.txHash}`);
    if (r.error)   console.log(`           Err: ${r.error}`);
  });

  return results;
}

// ─── 6. DELEGATE KE SATU VALIDATOR SPESIFIK ──────────────────
async function delegateToOne(amountKii, validatorAddress) {
  section(`📤 Delegate ${amountKii} KII ke 1 Validator (EVM)`);
  const provider = getProvider();
  const wallet   = getWallet(provider);

  const stakingContract = new ethers.Contract(
    STAKING_PRECOMPILE_ADDRESS,
    STAKING_ABI,
    wallet
  );

  const amountWei = ethers.parseEther(amountKii.toString());
  console.log(`  From     : ${wallet.address}`);
  console.log(`  Validator: ${validatorAddress}`);
  console.log(`  Jumlah   : ${amountKii} KII`);

  try {
    const tx = await stakingContract.delegate(validatorAddress, { value: amountWei });
    console.log(`  Tx Hash  : ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  ✅ Berhasil! Block: ${receipt.blockNumber} | Gas: ${receipt.gasUsed.toString()}`);
    return receipt;
  } catch (err) {
    console.log(`  ⚠️  ${err.message}`);
    throw err;
  }
}

// ─── 7. UNDELEGATE TOKEN ─────────────────────────────────────
async function undelegate(amountKii, validatorAddress) {
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
  console.log(`  Validator: ${validatorAddress}`);
  console.log(`  Jumlah   : ${amountKii} KII`);

  const tx = await stakingContract.undelegate(validatorAddress, amountWei);
  console.log(`  Tx Hash  : ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  ✅ Berhasil undelegate! ⚠️  Token terkunci ~21 hari`);
  console.log(`  Block    : ${receipt.blockNumber}`);
  return receipt;
}

// ─── 8. REDELEGATE TOKEN ─────────────────────────────────────
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

  const tx = await stakingContract.redelegate(srcValidator, dstValidator, amountWei);
  console.log(`  Tx Hash  : ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  ✅ Berhasil redelegate! Langsung aktif tanpa unbonding.`);
  console.log(`  Block    : ${receipt.blockNumber}`);
  return receipt;
}

// ─── 9. KLAIM REWARD DARI 8 VALIDATOR ────────────────────────
async function claimRewardsAll() {
  section("💸 Klaim Reward dari 8 Validator Target (EVM)");

  const provider = getProvider();
  const wallet   = getWallet(provider);

  // Ambil address validator dari delegasi aktif yang cocok dengan target
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
    // Fallback: resolve dari nama validator target
    console.log("  ℹ️  Fallback: resolve validator dari nama...");
    const targets = await resolveTargetValidators();
    validatorAddresses = targets.map((t) => t.address);
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

// ─── 10. CLAIM FAUCET VIA WEBSITE ────────────────────────────
async function claimFaucetWeb(address) {
  section("🌐 Claim Faucet via Website");
  console.log(`  Endpoint : ${CONFIG.faucetUrl}`);
  console.log(`  Address  : ${address}`);

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
    } else {
      console.log(`  ⚠️  Status HTTP: ${res.status}`);
      if (res.status === 429) {
        console.log(`  ℹ️  Sudah claim dalam 24 jam terakhir. Coba lagi besok.`);
      }
    }
    return { status: res.status, data };
  } catch (err) {
    console.error(`  ❌ Gagal: ${err.message}`);
    console.log(`  ℹ️  Coba manual di: ${CONFIG.faucetUrl}`);
    throw err;
  }
}

// ─── 11. CLAIM FAUCET VIA DISCORD ────────────────────────────
async function claimFaucetDiscord(address) {
  section("🤖 Claim Faucet via Discord");

  if (!CONFIG.discordBotToken) {
    throw new Error(
      "DISCORD_BOT_TOKEN tidak ditemukan!\n" +
      "  Tambahkan ke .env: DISCORD_BOT_TOKEN=your_token"
    );
  }
  if (!CONFIG.discordFaucetChannel) {
    throw new Error(
      "DISCORD_FAUCET_CHANNEL_ID tidak ditemukan!\n" +
      "  Tambahkan ke .env: DISCORD_FAUCET_CHANNEL_ID=123456789"
    );
  }

  const faucetMessage = `$request ${address}`;
  console.log(`  Channel  : ${CONFIG.discordFaucetChannel}`);
  console.log(`  Pesan    : ${faucetMessage}`);

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
      console.log(`  ✅ Bot login: ${discordClient.user.tag}`);
      try {
        const channel = await discordClient.channels.fetch(CONFIG.discordFaucetChannel);
        if (!channel || !channel.isTextBased()) throw new Error("Channel tidak valid.");
        const sentMsg = await channel.send(faucetMessage);
        console.log(`  ✅ Pesan terkirim! ID: ${sentMsg.id}`);
        clearTimeout(timeout);
        discordClient.destroy();
        resolve({ messageId: sentMsg.id });
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
      reject(new Error(`Gagal login bot: ${err.message}`));
    });
  });
}

// ─── MAIN ────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀 KiiChain Staking Script — Delegate ke 8 Validator");
  console.log(`   Network  : ${CONFIG.chainName} (Chain ID: ${CONFIG.chainId})`);
  console.log(`   RPC EVM  : ${CONFIG.evmRpcEndpoint}`);
  console.log(`   LCD      : ${CONFIG.lcdEndpoint}`);
  console.log(`\n   Target Validator (${TARGET_VALIDATORS.length}):`);
  TARGET_VALIDATORS.forEach((v, i) => console.log(`     ${i + 1}. ${v}`));

  try {
    const provider = getProvider();
    const wallet   = getWallet(provider);
    console.log(`\n   Wallet (EVM) : ${wallet.address}`);

    // ── READ-ONLY (selalu jalan) ───────────────────────────
    await checkBalance();
    await getValidators();
    await getDelegations();
    await getRewards();

    // ── FAUCET (uncomment salah satu) ─────────────────────

    // Klaim 2.500 KII via website
    // await claimFaucetWeb(wallet.address);

    // Klaim via Discord
    // await claimFaucetDiscord(wallet.address);

    // ── STAKING KE 8 VALIDATOR (uncomment untuk aktifkan) ──

    // ✅ DELEGATE ke 8 validator (dibagi merata)
    // Contoh: delegate total 8 KII → masing-masing validator dapat 1 KII
    // await delegateToAll(8);

    // Atau delegate jumlah lain, misal 16 KII → 2 KII per validator
    // await delegateToAll(16);

    // Delegate ke 1 validator spesifik (gunakan address kiivaloper1...)
    // await delegateToOne(1, "kiivaloper1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

    // Undelegate dari 1 validator spesifik
    // await undelegate(0.5, "kiivaloper1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

    // Redelegate antar validator
    // await redelegate(1, "kiivaloper1src...", "kiivaloper1dst...");

    // Klaim semua reward dari validator yang sudah didelegasikan
    // await claimRewardsAll();

    console.log("\n✅ Selesai!\n");
  } catch (err) {
    console.error("\n❌ Error:", err.message || err);
    process.exit(1);
  }
}

main();
