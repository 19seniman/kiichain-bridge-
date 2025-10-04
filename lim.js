const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

// --- 1. KONFIGURASI JARINGAN EVM (Kii Testnet Oro) ---
const EVM_CONFIG = {
    RPC_URL: 'https://json-rpc.uno.sentry.testnet.v3.kiivalidator.com/',
    CHAIN_ID: 1336,
    // Tetap pada alamat kontrak sistem yang diberikan
    BRIDGE_CONTRACT_ADDRESS: '0x0000000000000000000000000000000000001002', 
    // !!! GANTI INI DENGAN CHANNEL ID IBC KII CHAIN KE JARINGAN TUJUAN (misal: 'channel-0') !!!
    IBC_CHANNEL_ID: 'channel-X', 
    IBC_PORT: 'transfer', 
};

// --- 2. KONFIGURASI TRANSAKSI BRIDGE ---
const GLOBAL_CONFIG = {
    PRIVATE_KEY: process.env.PRIVATE_KEY, 
    AMOUNT_TO_SEND_EVM: '0.1', // Jumlah KII
    COSMOS_CONFIG_FILE: 'cosmos.json',
};

// --- 3. ABI IBC EVM STANDAR ---
// Ini adalah ABI yang sering digunakan oleh precompiled contracts IBC
const IBC_ABI = [
    // Fungsi Transfer IBC standar:
    "function transfer(string tokenDenom, uint256 amount, string receiver, string sourcePort, string sourceChannel, uint64 timeoutTimestamp, string memo)"
];

/**
 * Fungsi untuk memuat alamat tujuan dari file JSON. (Tidak Berubah)
 */
function loadCosmosRecipient() {
    try {
        const data = fs.readFileSync(GLOBAL_CONFIG.COSMOS_CONFIG_FILE, 'utf8');
        const config = JSON.parse(data);
        const recipient = config.recipientAddress;
        
        if (!recipient || recipient.startsWith('kii1...') || recipient === '' || EVM_CONFIG.IBC_CHANNEL_ID === 'channel-X') {
            throw new Error("Alamat tujuan di cosmos.json, atau IBC_CHANNEL_ID belum disetel dengan benar.");
        }
        return recipient;
    } catch (error) {
        console.error(`🚨 GAGAL: ${error.message}`);
        process.exit(1); 
    }
}

/**
 * Fungsi utama untuk menjembatani token dari EVM ke Cosmos.
 */
async function bridgeEVMToCosmos() {
    const cosmosRecipientAddress = loadCosmosRecipient();
    if (!GLOBAL_CONFIG.PRIVATE_KEY) return; // Keluar jika kunci pribadi tidak ada.

    try {
        const provider = new ethers.JsonRpcProvider(EVM_CONFIG.RPC_URL, EVM_CONFIG.CHAIN_ID);
        const wallet = new ethers.Wallet(GLOBAL_CONFIG.PRIVATE_KEY, provider);
        // Buat instance kontrak dengan ABI IBC
        const ibcContract = new ethers.Contract(EVM_CONFIG.BRIDGE_CONTRACT_ADDRESS, IBC_ABI, wallet);
        
        const senderAddress = await wallet.getAddress();
        const amountWei = ethers.parseUnits(GLOBAL_CONFIG.AMOUNT_TO_SEND_EVM, 'ether');
        
        // Timeout (Timestamp harus dalam nanodetik)
        const timeoutInSeconds = 60 * 10; // 10 menit
        const timeoutTimestamp = BigInt(Math.floor(Date.now() / 1000) + timeoutInSeconds) * BigInt(1_000_000_000);

        console.log(`✅ Terhubung. Pengirim: ${senderAddress}`);
        console.log(`⏳ Mencoba IBC Transfer melalui Channel ${EVM_CONFIG.IBC_CHANNEL_ID}...`);

        // --- Panggilan Fungsi IBC Kontrak ---
        const tx = await ibcContract.transfer(
            'KII', // Denom token natif (Asumsi: 'KII')
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
            console.log("Ini mungkin berarti ABI/Fungsi masih salah, atau Channel ID tidak valid.");
        }

    } catch (error) {
        console.error('❌ Terjadi Kesalahan Kritis saat bridging:', error.message);
        console.log("\n***\nLANGKAH SELANJUTNYA:");
        console.log("1. **Cari IBC Channel ID** Kii Chain ke Cosmos tujuan Anda. Ganti 'channel-X'.");
        console.log("2. Jika gagal lagi, berarti ABI/Parameter fungsi `transfer` ini salah. Anda harus **mencari dokumentasi Kii Chain** untuk IBC/Bridge Precompiled Contract.");
    }
}

// Jalankan fungsi
bridgeEVMToCosmos();
