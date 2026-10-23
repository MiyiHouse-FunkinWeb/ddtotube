# DDTOTUBE

Platform video + live streaming (mirip YouTube) dengan:
- Upload video, like, komentar, follow, cari video
- **Thumbnail custom wajib verifikasi nomor HP** (OTP)
- **Live streaming** (WebRTC): kamera, **screen live**, OBS Virtual Camera
- **PngTuber/VTuber**: avatar bergerak mengikuti suara mic (bisa pakai PNG sendiri: mulut tutup & buka)
- **Centang ✓ otomatis** saat 100 pengikut
- Bisa di-install di HP (PWA) dan dijadikan APK

## Jalankan di komputer / server
```
npm install
npm start
```
Buka http://localhost:3000

## Biar ONLINE (gratis/murah)
1. Upload folder ini ke GitHub.
2. Deploy ke **Render.com** / **Railway.app** / VPS (Node.js).
   - Build: `npm install`  |  Start: `npm start`
   - Wajib **HTTPS** (Render/Railway otomatis) — kamera, mic, share layar hanya jalan di HTTPS.
3. Pasang **Persistent Disk/Volume** di path `/data` dan set env `DATA_DIR=/data`,
   kalau tidak, video & akun hilang saat server restart.

## Verifikasi nomor HP (OTP)
- Default = **mode tes**: kode OTP muncul di layar (supaya bisa dicoba tanpa biaya).
- Mode asli: daftar di [Fonnte](https://fonnte.com) (WA/SMS Indonesia), set env `FONNTE_TOKEN=tokenmu`. Provider lain (Twilio, Zenziva) tinggal ganti fungsi `sendSms` di `server.js`.

## Jadi APK (dari HP)
Setelah web online (HTTPS):
1. Buka https://www.pwabuilder.com → masukkan URL web kamu → **Package for stores → Android** → download APK.
2. Atau di Chrome HP: menu ⋮ → **Install app / Tambahkan ke layar utama**.

## Pakai OBS
1. PC: OBS → **Start Virtual Camera**.
2. Di DDTOTUBE → Mulai Live → centang **Kamera** → pilih "OBS Virtual Camera".
(OBS = scene/overlay/filter apa pun, hasilnya jadi video live.)

## Catatan skala
Live memakai WebRTC peer-to-peer: nyaman untuk ±10–30 penonton per streamer.
Untuk ribuan penonton perlu SFU (LiveKit / mediasoup) + server TURN.
