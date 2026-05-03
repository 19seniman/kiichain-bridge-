require("dotenv").config();
const { SigningStargateClient, StargateClient, coin } = require("@cosmjs/stargate");
const { DirectSecp256k1Wallet } = require("@cosmjs/proto-signing");
const { Client, GatewayIntentBits, Partials } = require("discord.js");

// ─── KONFIGURASI ────────────────────────────────────────────
const CONFIG = {
  // Endpoint KiiChain Testnet Oro
  rpcEndpoint: "https://rpc.uno.sentry.testnet.v3.kiivalidator.com",
  lcdEndpoint: "https://lcd.uno.sentry.testnet.v3.kiivalidator.com",
  faucetUrl:   "https://explorer.kiichain.io/faucet",

  // Chain info
  chainId: "kiichain3",
  denom:   "ukii",   // 1 KII = 1_000_000 ukii
  prefix:  "kii",

  // Private key dari .env (hex, boleh dengan/tanpa "0x")
  privateKey: process.env.KIICHAIN_PRIVATE_KEY || "",

  // Validator tujuan staking — ganti sesuai kebutuhan
  validatorAddress: "kiivaloper1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",

  // Discord config dari .env
  discordBotToken:      process.env.DISCORD_BOT_TOKEN        || "",
  discordFaucetChannel: process.env.DISCORD_FAUCET_CHANNEL_ID || "",

  gasPrice: "0.025ukii",
};
// ────────────────────────────────────────────────────────────

// ─── HELPERS ─────────────────────────────────────────────────
function formatKii(amount) {
  return (Number(amount) / 1_000_000).toFixed(6) + " KII";
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
  const clean = pkHex.trim().replace(/^0x/i, "");
  if (clean.length !== 64) {
    throw new Error(`Private key harus 64 karakter hex, diterima: ${clean.length}`);
  }
  return Uint8Array.from(Buffer.from(clean, "hex"));
}

// ─── INISIALISASI WALLET ─────────────────────────────────────
async function getWallet() {
  const privKeyBytes = parsePrivateKey(CONFIG.privateKey);
  const wallet = await DirectSecp256k1Wallet.fromKey(privKeyBytes, CONFIG.prefix);
  const [account] = await wallet.getAccounts();
  return { wallet, address: account.address };
}

// ─── 1. CEK SALDO WALLET ─────────────────────────────────────
async function checkBalance(address) {
  section("💰 Saldo Wallet");
  const client = await StargateClient.connect(CONFIG.rpcEndpoint);
  const balance = await client.getBalance(address, CONFIG.denom);
  console.log(`  Address  : ${address}`);
  console.log(`  Saldo    : ${formatKii(balance.amount)} (${balance.amount} ${balance.denom})`);
  await client.disconnect();
  return balance;
}

// ─── 2. DAFTAR VALIDATOR AKTIF ───────────────────────────────
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
    console.log(`       Total Stake: ${formatKii(v.tokens)}`);
    console.log(`       Commission : ${commission}%`);
    console.log(`       Status     : ${v.status}`);
  });
  return validators;
}

// ─── 3. LIHAT DELEGASI AKTIF ─────────────────────────────────
async function getDelegations(delegatorAddress) {
  section("📋 Delegasi Aktif");
  const res = await fetch(
    `${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/delegations/${delegatorAddress}`
  );
  const data = await res.json();
  const delegations = data.delegation_responses || [];
  if (delegations.length === 0) {
    console.log("  Tidak ada delegasi aktif.");
    return delegations;
  }
  delegations.forEach((d) => {
    console.log(`\n  Validator : ${d.delegation.validator_address}`);
    console.log(`  Jumlah    : ${formatKii(d.balance.amount)}`);
  });
  return delegations;
}

// ─── 4. LIHAT REWARD BELUM DIKLAIM ───────────────────────────
async function getRewards(delegatorAddress) {
  section("🎁 Reward Staking (Belum Diklaim)");
  const res = await fetch(
    `${CONFIG.lcdEndpoint}/cosmos/distribution/v1beta1/delegators/${delegatorAddress}/rewards`
  );
  const data = await res.json();
  const rewards = data.rewards || [];
  if (rewards.length === 0) {
    console.log("  Belum ada reward.");
    return;
  }
  rewards.forEach((r) => {
    const ukiiReward = r.reward.find((t) => t.denom === CONFIG.denom);
    if (ukiiReward) {
      console.log(`\n  Validator : ${r.validator_address}`);
      console.log(`  Reward    : ${formatKii(parseFloat(ukiiReward.amount).toFixed(0))}`);
    }
  });
  const total = data.total?.find((t) => t.denom === CONFIG.denom);
  if (total) {
    console.log(`\n  ─── Total reward: ${formatKii(parseFloat(total.amount).toFixed(0))}`);
  }
}

// ─── 5. DELEGATE TOKEN ───────────────────────────────────────
async function delegate(amountKii) {
  section(`📤 Delegate ${amountKii} KII`);
  const { wallet, address } = await getWallet();
  const client = await SigningStargateClient.connectWithSigner(
    CONFIG.rpcEndpoint, wallet,
    { gasPrice: { amount: "0.025", denom: CONFIG.denom } }
  );
  const amountUkii = Math.floor(amountKii * 1_000_000).toString();
  const result = await client.delegateTokens(
    address, CONFIG.validatorAddress,
    coin(amountUkii, CONFIG.denom), "auto",
    `Delegate ${amountKii} KII via KiiChain Script`
  );
  console.log(`  ✅ Berhasil delegate ${amountKii} KII!`);
  console.log(`  Tx Hash : ${result.transactionHash}`);
  console.log(`  Block   : ${result.height}`);
  await client.disconnect();
  return result;
}

// ─── 6. UNDELEGATE TOKEN ─────────────────────────────────────
async function undelegate(amountKii) {
  section(`📥 Undelegate ${amountKii} KII`);
  const { wallet, address } = await getWallet();
  const client = await SigningStargateClient.connectWithSigner(
    CONFIG.rpcEndpoint, wallet,
    { gasPrice: { amount: "0.025", denom: CONFIG.denom } }
  );
  const amountUkii = Math.floor(amountKii * 1_000_000).toString();
  const result = await client.undelegateTokens(
    address, CONFIG.validatorAddress,
    coin(amountUkii, CONFIG.denom), "auto",
    `Undelegate ${amountKii} KII via KiiChain Script`
  );
  console.log(`  ✅ Berhasil undelegate ${amountKii} KII!`);
  console.log(`  ⚠️  Token terkunci selama masa unbonding (~21 hari)`);
  console.log(`  Tx Hash : ${result.transactionHash}`);
  console.log(`  Block   : ${result.height}`);
  await client.disconnect();
  return result;
}

// ─── 7. REDELEGATE TOKEN ─────────────────────────────────────
async function redelegate(amountKii, srcValidator, dstValidator) {
  section(`🔄 Redelegate ${amountKii} KII`);
  const { wallet, address } = await getWallet();
  const client = await SigningStargateClient.connectWithSigner(CONFIG.rpcEndpoint, wallet);
  const amountUkii = Math.floor(amountKii * 1_000_000).toString();
  const msg = {
    typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
    value: {
      delegatorAddress: address,
      validatorSrcAddress: srcValidator,
      validatorDstAddress: dstValidator,
      amount: coin(amountUkii, CONFIG.denom),
    },
  };
  const result = await client.signAndBroadcast(address, [msg], "auto", "Redelegate via KiiChain Script");
  console.log(`  ✅ Berhasil redelegate ${amountKii} KII!`);
  console.log(`  Dari    : ${srcValidator}`);
  console.log(`  Ke      : ${dstValidator}`);
  console.log(`  Tx Hash : ${result.transactionHash}`);
  await client.disconnect();
  return result;
}

// ─── 8. KLAIM REWARD ─────────────────────────────────────────
async function claimRewards() {
  section("💸 Klaim Semua Reward Staking");
  const { wallet, address } = await getWallet();
  const client = await SigningStargateClient.connectWithSigner(CONFIG.rpcEndpoint, wallet);
  const res = await fetch(
    `${CONFIG.lcdEndpoint}/cosmos/staking/v1beta1/delegations/${address}`
  );
  const data = await res.json();
  const delegations = data.delegation_responses || [];
  if (delegations.length === 0) {
    console.log("  Tidak ada delegasi aktif untuk diklaim rewardnya.");
    await client.disconnect();
    return;
  }
  const msgs = delegations.map((d) => ({
    typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
    value: {
      delegatorAddress: address,
      validatorAddress: d.delegation.validator_address,
    },
  }));
  const result = await client.signAndBroadcast(
    address, msgs, "auto", "Klaim reward via KiiChain Script"
  );
  console.log(`  ✅ Berhasil klaim reward dari ${msgs.length} validator!`);
  console.log(`  Tx Hash : ${result.transactionHash}`);
  console.log(`  Block   : ${result.height}`);
  await client.disconnect();
  return result;
}

// ─── 9. CLAIM FAUCET VIA WEBSITE ─────────────────────────────
/**
 * Mengirim POST request ke faucet explorer.kiichain.io
 * Limit  : 2.500 KII per 24 jam per address
 * URL    : https://explorer.kiichain.io/faucet
 */
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
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (res.ok) {
      console.log(`  ✅ Faucet berhasil diklaim!`);
      if (data.txhash || data.tx_hash) {
        console.log(`  Tx Hash : ${data.txhash || data.tx_hash}`);
      }
      if (data.amount) {
        console.log(`  Jumlah  : ${formatKii(data.amount)}`);
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
/**
 * Login ke Discord sebagai bot → kirim pesan "$request <address>"
 * ke channel #faucet KiiChain.
 *
 * Format pesan yang dikirim: $request <wallet_address>
 * Contoh : $request kii1abc123def456...
 *
 * Syarat:
 *  - DISCORD_BOT_TOKEN   → token bot dari discord.com/developers
 *  - DISCORD_FAUCET_CHANNEL_ID → ID channel #faucet server KiiChain
 *  - Bot sudah join server KiiChain & punya permission "Send Messages"
 */
async function claimFaucetDiscord(address) {
  section("🤖 Claim Faucet via Discord");

  // Validasi konfigurasi
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

  // Pesan yang akan dikirim ke channel Discord
  const faucetMessage = `$request ${address}`;

  console.log(`  Channel ID   : ${CONFIG.discordFaucetChannel}`);
  console.log(`  Pesan        : ${faucetMessage}`);
  console.log(`  Menghubungkan bot ke Discord...`);

  // Inisialisasi Discord client
  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  return new Promise((resolve, reject) => {
    // Timeout 30 detik jika gagal login
    const timeout = setTimeout(() => {
      discordClient.destroy();
      reject(new Error("Timeout: Bot Discord tidak bisa login dalam 30 detik."));
    }, 30_000);

    discordClient.once("ready", async () => {
      console.log(`  ✅ Bot login sebagai: ${discordClient.user.tag}`);

      try {
        // Fetch channel berdasarkan ID
        const channel = await discordClient.channels.fetch(CONFIG.discordFaucetChannel);

        if (!channel) {
          throw new Error(`Channel ID ${CONFIG.discordFaucetChannel} tidak ditemukan.`);
        }
        if (!channel.isTextBased()) {
          throw new Error(`Channel "${channel.name}" bukan text channel.`);
        }

        console.log(`  📢 Mengirim ke #${channel.name}...`);

        // Kirim: $request <address>
        const sentMsg = await channel.send(faucetMessage);

        console.log(`  ✅ Pesan berhasil dikirim!`);
        console.log(`  Message ID   : ${sentMsg.id}`);
        console.log(`  Isi Pesan    : ${sentMsg.content}`);
        console.log(`  ℹ️  Tunggu balasan bot faucet di #${channel.name}`);
        console.log(`  ℹ️  Faucet mengirimkan 2.500 KII per 24 jam per address`);

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

    // Login bot
    discordClient.login(CONFIG.discordBotToken).catch((err) => {
      clearTimeout(timeout);
      reject(new Error(`Gagal login bot Discord: ${err.message}`));
    });
  });
}

// ─── MAIN ────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀 KiiChain Staking + Faucet Script");
  console.log(`   Network  : ${CONFIG.chainId} (Testnet Oro)`);
  console.log(`   RPC      : ${CONFIG.rpcEndpoint}`);
  console.log(`   Faucet   : ${CONFIG.faucetUrl}`);

  try {
    const { address } = await getWallet();
    console.log(`\n   Wallet   : ${address}`);

    // ── READ-ONLY ──────────────────────────────────────────
    await checkBalance(address);
    await getValidators();
    await getDelegations(address);
    await getRewards(address);

    // ── FAUCET (uncomment salah satu atau keduanya) ────────

    // Klaim 2.500 KII via website explorer.kiichain.io/faucet
    // await claimFaucetWeb(address);

    // Klaim 2.500 KII via Discord (format: $request <address>)
    // await claimFaucetDiscord(address);

    // ── STAKING (uncomment untuk mengaktifkan) ─────────────

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
