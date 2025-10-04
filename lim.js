const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

// --- 1. KONFIGURASI JARINGAN EVM (Kii Testnet Oro) ---
const EVM_CONFIG = {
    RPC_URL: 'https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/',
    CHAIN_ID: 1336,
    BRIDGE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000001002', 
    // NILAI BARU DARI PENGGUNA:
    IBC_CHANNEL_ID: 'channel-1', 
    IBC_PORT: 'transfer', 
};

// --- 2. KONFIGURASI TRANSAKSI BRIDGE ---
const GLOBAL_CONFIG = {
    PRIVATE_KEY: process.env.PRIVATE_KEY, 
    AMOUNT_TO_SEND_EVM: '0.1', // Jumlah KII
    COSMOS_CONFIG_FILE: 'cosmos.json',
};

// --- 3. ABI IBC EVM STANDAR ---
const IBC_ABI = [
    // Fungsi Transfer IBC standar yang paling umum:
    "function transfer(string tokenDenom, uint256 amount, string receiver, string sourcePort, string sourceChannel, uint64 timeoutTimestamp, string memo)"
];

/**
 * Fungsi untuk memuat alamat tujuan dari file JSON.
 */
function loadCosmosRecipient() {
    try {
        const data = fs.readFileSync(GLOBAL_CONFIG.COSMOS_CONFIG_FILE, 'utf8');
        const config = JSON.parse(data);
        const recipient = config.recipientAddress;
        
        // Memeriksa validasi Channel ID dan Alamat Penerima
        if (!recipient || recipient.startsWith('kii1...') || recipient === '' || EVM_CONFIG.IBC_CHANNEL_ID.startsWith('channel-X')) {
            // Eror ini seharusnya sudah hilang setelah Anda mengganti nilai
            throw new Error("Alamat tujuan di cosmos.json, atau IBC_CHANNEL_ID belum disetel dengan benar.");
        }
        return recipient;
    } catch (error) {
        console.error(`🚨 GAGAL memuat konfigurasi: ${error.message}`);
        process.exit(1); 
    }
}

// ---

/**
 * Fungsi utama untuk menjembatani token dari EVM ke Cosmos.
 */
async function bridgeEVMToCosmos() {
    const cosmosRecipientAddress = loadCosmosRecipient();
    if (!GLOBAL_CONFIG.PRIVATE_KEY) return;

    try {
        const provider = new ethers.JsonRpcProvider(EVM_CONFIG.RPC_URL, EVM_CONFIG.CHAIN_ID);
        const wallet = new ethers.Wallet(GLOBAL_CONFIG.PRIVATE_KEY, provider);
        const ibcContract = new ethers.Contract(EVM_CONFIG.BRIDGE_CONTRACT_ADDRESS, IBC_ABI, wallet);
        
        const senderAddress = await wallet.getAddress();
        const amountWei = ethers.parseUnits(GLOBAL_CONFIG.AMOUNT_TO_SEND_EVM, 'ether');
        
        const timeoutInSeconds = 60 * 10; // 10 menit
        const timeoutTimestamp = BigInt(Math.floor(Date.now() / 1000) + timeoutInSeconds) * BigInt(1_000_000_000);

        console.log(`✅ Terhubung. Pengirim: ${senderAddress}`);
        console.log(`DESTINASI: ${cosmosRecipientAddress} melalui ${EVM_CONFIG.IBC_PORT}/${EVM_CONFIG.IBC_CHANNEL_ID}`);
        console.log(`⏳ Mencoba IBC Transfer ${GLOBAL_CONFIG.AMOUNT_TO_SEND_EVM} KII...`);

        // --- Panggilan Fungsi IBC Kontrak dengan Parameter Lengkap ---
        const tx = await ibcContract.transfer(
            'KII', // Denom (Asumsi: 'KII' untuk token natif)
            amountWei,
            cosmosRecipientAddress,
            EVM_CONFIG.IBC_PORT,
            EVM_CONFIG.IBC_CHANNEL_ID,
            timeoutTimestamp,
            '', // Memo
            { 
                value: amountWei, // Mengirim KII natif sebagai value
                gasLimit: 500000 
            } 
        );

        console.log(`⏳ Transaksi IBC terkirim. Hash: ${tx.hash}`);
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            console.log("🎉 IBC Transfer Berhasil dikonfirmasi di EVM!");
            console.log(`🔗 Cek status transfer di explorer. Tx Hash: ${receipt.hash}`);
        } else {
            console.error("❌ Transaksi gagal dikonfirmasi di EVM. Status: 0 (Reverted)");
            console.log("Ini kemungkinan besar berarti ABI/Fungsi `transfer` atau parameternya masih salah untuk kontrak 0x1002.");
        }

    } catch (error) {
        console.error('❌ Terjadi Kesalahan Kritis:', error.message);
    }
}

// Jalankan fungsi
bridgeEVMToCosmos();
