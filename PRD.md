# PRD — Reel Farmer

**Versi**: 4.5 · **Status**: Living document · **Terakhir diperbarui**: 13 Agustus 2026
**Cakupan**: Bagian 1–5 mendeskripsikan kondisi kode **saat ini** (tool lokal, single-user). Bagian 6–10 mendeskripsikan **arah produk yang sudah diputuskan** menuju SaaS berarsitektur **hybrid desktop app** dan **belum diimplementasikan**.

---

## 0. Keputusan Arah Produk

### 0.1 Keputusan yang sudah diambil

| #   | Keputusan                      | Pilihan                                                                                                                                                                                                                                |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Arsitektur compute             | **Hybrid** — desktop app di device user menjalankan seluruh kerja berat (download, whisper, ffmpeg, render). Cloud hanya untuk orkestrasi ringan: auth, license check, dan (nanti) Radar Detector.                                     |
| 2   | Persona prioritas              | **Solo repurposer** (individu, 1–3 channel klip) divalidasi lebih dulu. Agensi & tim in-house menyusul setelah arsitektur inti stabil.                                                                                                 |
| 3   | Model bisnis                   | **BYOK** — user pakai API key AI sendiri (mis. DeepSeek). Produk dijual sebagai software (lisensi/langganan), bukan menjual kuota compute/AI.                                                                                          |
| 4   | Framework desktop app          | **Tauri** — dipilih karena hemat resource (tidak menyeret runtime Chromium terpisah seperti Electron), cocok dengan constraint "middle budget komputer".                                                                               |
| 5   | Strategi distribusi dependency | **Installer minimal + download pasca-instalasi** — installer hanya berisi aplikasi inti; `yt-dlp`, `ffmpeg`, `whisper-cli`, dan model GGML diunduh otomatis setelah instalasi (first-run atau on-demand), bukan dibundle di installer. |
| 6   | Fitur "auto-watch"             | Diubah nama & posisi jadi **Radar Detector** — fitur berbayar (nice-to-have, bukan prioritas Fase 1/2 awal), lihat §7.2.                                                                                                               |

### 0.2 Implikasi langsung dari keputusan ini

- **Tidak ada Postgres/worker-pool/object-storage wajib** — cloud footprint kecil: auth/license + (nanti) Radar Detector polling. Tidak ada compute video di server.
- **"Middle budget komputer" terjawab** oleh keputusan #1, #3, #4 — biaya compute & AI ditanggung user; framework Tauri menjaga jejak resource app sendiri tetap kecil di device user.
- **Dashboard web (v2 §3.3) menjadi UI native Tauri** — webview Tauri me-render UI yang sama (React/dsb.), tapi dibungkus shell native, bukan diakses via browser terpisah.
- **Tidak ada cloud sync run/hasil** — semua file tetap 100% di device user.
- **Ukuran installer kecil secara sengaja** — trade-off-nya adalah user butuh koneksi internet & waktu tunggu di first-run untuk mengunduh dependency (terutama model GGML Whisper yang bisa ratusan MB–GB). Ini harus dikomunikasikan jelas di UX onboarding (lihat §6.5).
- **Radar Detector eksplisit di-tag nice-to-have** — tidak masuk sprint Fase 1/2 awal (§5, §6.2); ditempatkan sebagai fitur berbayar yang divalidasi setelah fondasi desktop app stabil.

---

## 1. Ringkasan & Pengguna

### 1.1 Apa ini

Pipeline otomatis: **video YouTube long-form → banyak klip vertikal (TikTok/Shorts/Reels) siap upload**. Sistem mendeteksi momen yang layak viral, memotong video, membuang jeda diam, dan menambahkan caption bergaya karaoke. Saat ini berjalan via CLI + dashboard web lokal; arah produk berikutnya membungkusnya jadi **desktop app (Tauri)**.

### 1.2 Siapa penggunanya

| Persona                      | Situasi                                                                    | Kebutuhan utama                                                  | Prioritas validasi                       |
| ----------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| **Solo repurposer** (primer) | Mengelola 1–3 channel klip dari sumber panjang (ceramah, podcast, lecture) | Cepat dari 1 video → banyak kandidat klip, minim sentuhan manual | **Sekarang**                              |
| **Editor agensi kecil**      | Menangani beberapa klien sekaligus                                         | Batch, konsistensi brand, hand-off hasil ke klien                | Setelah arsitektur hybrid stabil          |
| **Content team in-house**    | Podcast/webinar internal jadi konten sosial                                | Kolaborasi, approval, publishing terjadwal                       | Butuh cloud sync — di luar cakupan dekat  |

### 1.3 Job to be done

> "Saya punya video 90 menit. Saya ingin 10 klip terbaik darinya, sudah tercaption dan siap upload, tanpa harus menonton ulang seluruh videonya — dan tanpa harus percaya data saya ke server orang lain."

### 1.4 Prinsip produk

1. **Otomatis dulu, manual kalau perlu** — default full-auto; review manual adalah opsi, bukan kewajiban.
2. **Resumable** — proses mahal (download, transcribe, render) tidak pernah diulang tanpa alasan.
3. **Satu sumber kebenaran per device** — 1 database lokal (SQLite) yang dibaca UI desktop app.
4. **Jangan bikin abstraksi sebelum ada 2 pemakai konkret.**
5. **Local-first** — data user tidak pernah wajib meninggalkan device-nya untuk fitur inti (download → caption). Fitur yang butuh cloud (Radar Detector, publish terjadwal) harus eksplisit opt-in dan berbayar.

### 1.5 Alur aplikasi — target setelah perubahan ini (baru)

Penyesuaian yang diminta user (13 Agustus 2026) menambah 2 titik keputusan baru ke alur review-manual (§2.3/§3.3), semuanya **opsional** — kalau user tidak menyentuhnya, alur full-auto yang ada sekarang tidak berubah (Prinsip #1). Gap kode untuk tiap langkah baru didaftar di §4 (G15, G19, G20, G21) dan §5.

1. **Buat run & identifikasi** — tidak berubah (download → transcribe → identify → `awaiting_selection`).
2. **Review & seleksi klip** (`RunDetail.tsx`) — tidak berubah: pilih kandidat AI, trim, tambah custom/import JSON. Kalau kandidat AI dari DeepSeek masih kurang banyak/kurang cocok, user bisa **"Generate More Clips"** — re-run `IDENTIFY_CLIPS` untuk kandidat tambahan pada run yang sama, tanpa mengulang download/transcribe (menutup G18, dinaikkan prioritasnya — lihat §5).
3. **Pilih & preview caption style** *(diperluas)* — sebelum klik "Export Selected", user melihat live preview overlay caption (font, warna, posisi, animasi) di atas potongan video yang sudah ditrim — bukan sekadar memilih nama preset dari dropdown seperti sekarang. Mesin preview-nya sudah ada di `CaptionEditor.tsx` (lihat §3.3), tinggal dipakai ulang di titik ini sebelum render pertama, bukan hanya setelahnya (menutup sisa G15).
4. **Pre-Production** *(baru, opsional, semua default kosong/off)* — sebelum render final:
   - **Thumbnail kustom** — upload gambar atau pilih 1 frame dari video sebagai cover.
   - **Watermark** — logo/brand mark milik user sendiri, muncul sepanjang klip; posisi & opacity diatur user.
   - **Ending watermark / outro** — card atau watermark khusus yang hanya muncul di beberapa detik terakhir klip (mis. "follow for more").
   Ini terpisah dari watermark paksa "Reel Farmer" di tier free (§8.2) — lihat catatan di §7.1 & §8.2.
5. **Export Selected** → `EXTRACT_CLIPS` → `REMOVE_SILENCE` → `GENERATE_CAPTIONS` → *(baru, kondisional)* terapkan watermark/ending watermark kalau diaktifkan di langkah 4 → `COMPOSE_REEL`.
6. **Post-render** — Caption Editor untuk fine-tuning per klip + regenerate overlay saja, Library, delete — tidak berubah.

Ini murni penyesuaian urutan pemakaian UI + 1 titik kerja opsional di `COMPOSE_REEL`; tidak mengubah prinsip arsitektur hybrid (§6) atau model bisnis (§8).

---

## 2. Cara Pakai (Quick Start — kondisi kode saat ini)

### 2.1 Prasyarat

| Kebutuhan                                 | Catatan                          |
| ------------------------------------------ | --------------------------------- |
| Bun                                        | Runtime utama                     |
| `yt-dlp`                                   | Download video sumber             |
| `ffmpeg`                                   | Extract, desilence, compose       |
| `whisper-cli` + model GGML di `./models/`  | Timestamp per kata untuk caption  |
| `DEEPSEEK_API_KEY`                         | Identifikasi klip                 |

### 2.2 Alur tercepat (full-auto)

```bash
bun run src/index.ts pipeline <youtube-url>
# hasil akhir: ./output/<video-id>/*.mp4
```

### 2.3 Alur dengan review manual

```bash
bun run src/web/server.ts        # buka http://localhost:3001
```

1. Buat run baru dari URL YouTube (atau pilih video yang sudah pernah didownload).
2. Tunggu sampai status **awaiting selection** — DeepSeek sudah mengembalikan kandidat klip.
3. Pilih klip yang mau dirender, trim start/end di timeline, atau tambah klip custom / import JSON. Kurang kandidat? Generate more (§1.5, G18).
4. Pilih style caption & preview sebelum export (§1.5) — opsional: atur thumbnail/watermark/ending watermark di Pre-Production (§1.5, G19).
5. Setelah render, edit caption (teks & timing per kata) lalu re-render overlay saja.

### 2.4 Kalau macet

| Gejala                 | Tindakan                                                               |
| ----------------------- | ------------------------------------------------------------------------ |
| Run berhenti di tengah | `bun run src/index.ts resume <run-id>`                                 |
| Tidak tahu status      | `bun run src/index.ts status [run-id]`                                 |
| Disk penuh             | `bun run src/index.ts clean <run-id>` (`--all` termasuk output final)  |

### 2.5 Konfigurasi penting

| Env var                                         | Default | Efek                                        |
| ------------------------------------------------- | ------- | -------------------------------------------- |
| `MAX_PARALLEL_CLIPS`                            | 3       | Paralelisme stage per-klip dalam 1 run       |
| `CLIP_SPEED`                                    | 1.2     | Speed-up klip saat extract                   |
| `SILENCE_THRESHOLD_DB` / `SILENCE_MIN_DURATION` | —       | Sensitivitas deteksi jeda diam               |
| `WHISPER_MODEL` / `WHISPER_LANGUAGE`            | —       | Model & bahasa transkripsi fallback          |
| `CAPTION_ANIMATE`                               | on      | Animasi karaoke (kata aktif berubah warna)   |
| `CAPTION_OFFSET_MS`                             | —       | Koreksi drift caption                        |
| `WEB_PORT`                                      | 3001    | Port dashboard                               |
| `preferYouTubeTranscripts`                      | on      | Pakai caption YouTube dulu sebelum Whisper   |

> **Catatan migrasi**: di desktop app (Tauri), §2.1–2.5 di atas akan disederhanakan jadi alur instalasi + onboarding otomatis (lihat §6.5) — dependency tidak lagi butuh setup manual, env var jadi setting UI. Bagian ini tetap dijaga sebagai dokumentasi kondisi kode CLI/web saat ini.

---

## 3. Fitur Saat Ini

### 3.1 Perintah CLI (`src/index.ts`)

| Command                                      | Fungsi                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline <url>`                             | Pipeline penuh 1 video: download → transcribe → identify → extract → desilence → caption → compose, tanpa berhenti untuk review. |
| `batch <channel-url> -l N [--skip-existing]` | Ambil sampai N video terbaru dari channel dan proses berurutan; lanjut ke video berikutnya kalau satu gagal.                     |
| `resume <run-id>`                            | Lanjutkan run terhenti — skip stage global yang sudah selesai, hanya proses klip yang belum selesai.                             |
| `status [run-id]`                            | Daftar run, atau detail 1 run (stage, status, error terakhir).                                                                    |
| `clean <run-id> [--all]`                     | Hapus artifact perantara (`--all` juga hapus output final).                                                                       |

### 3.2 Tahapan pipeline (`src/pipeline/orchestrator.ts`)

**Stage global** — sekali per video, berurutan:

| #   | Stage            | Isi                                                                                                                                                                                                                                       |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `DOWNLOAD`       | `yt-dlp` mengunduh video + metadata (judul, durasi, tanggal upload).                                                                                                                                                                     |
| 2   | `TRANSCRIBE`     | Transkrip dari YouTube caption API (`preferYouTubeTranscripts`, default on), fallback ke Whisper (`whisper-cli`).                                                                                                                        |
| 3   | `IDENTIFY_CLIPS` | Transkrip → DeepSeek (`deepseek-chat`) dengan prompt "viral content strategist" → `ClipCandidate[]` (judul, hook line, start/end, alasan, `viralScore`, tags). Difilter durasi 15–120 detik + batas video, lalu diurutkan berdasar skor. |

**Stage per-klip** — paralel, dibatasi `Semaphore` sesuai `MAX_PARALLEL_CLIPS`:

| #   | Stage               | Isi                                                                                                                                                                                        |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | `EXTRACT_CLIPS`     | FFmpeg memotong segmen sesuai timestamp, dengan opsi speed-up (`CLIP_SPEED`).                                                                                                             |
| 5   | `REMOVE_SILENCE`    | Deteksi jeda diam via FFmpeg lalu buang bagian diam.                                                                                                                                      |
| 6   | `GENERATE_CAPTIONS` | Audio klip → `whisper-cli` untuk timestamp per kata → align ke transkrip asli → grup 6 kata → render overlay WebM transparan via Remotion (`CaptionOverlay.tsx`), dengan animasi karaoke. |
| 7   | `COMPOSE_REEL`      | FFmpeg menggabungkan hasil desilence + overlay caption jadi MP4 final 1080×1920.                                                                                                          |

### 3.3 Dashboard web (`src/web/`)

Ini **fitur review-manual di atas pipeline otomatis**, bukan sekadar viewer. Menjadi basis UI desktop app di jalur baru (§6.5).

- **Manajemen run** (`App.tsx`) — buat run dari URL YouTube atau video yang sudah pernah didownload (`existingVideoId`), lihat daftar run + progres, hapus run.
- **Review & seleksi klip** (`RunDetail.tsx`) — user memilih klip mana yang dirender (tidak semua kandidat otomatis diproses), bisa menambah klip custom manual atau import daftar klip lewat JSON (upload file atau paste). Caption style dipilih dari dropdown preset (`captionPresets.ts`) sebelum "Export Selected" — **belum ada preview visual di titik ini** (lihat G15, §1.5 langkah 3).
- **Trim di video sumber** (`SourceVideoPlayer.tsx` + `ClipTimeline.tsx`) — drag start/end langsung di atas timeline video sumber sebelum diproses; streaming pakai HTTP range request (`serveVideoFile`).
- **Editor caption** (`CaptionEditor.tsx`) — edit teks & timing tiap kata (drag untuk resize durasi, klik untuk seek), pilih dari 3 preset style (Pop/Minimal/Elegant) atau atur manual (font, size, weight, line spacing, warna, outline, animasi), **live preview** overlay ter-render di atas video klip (`desilenced.mp4`, sebelum caption dibakar), retranscribe klip dalam bahasa lain, lalu re-render overlay saja (`regenerateCaptions`) tanpa mengulang seluruh pipeline. *(Dalam pengembangan — lihat status commit; preview & preset ini menutup sebagian besar G15, tapi masih hanya dapat diakses **setelah** render pertama, bukan sebelum "Export Selected" — lihat §1.5 langkah 3.)*
- **Progress real-time** — polling `/api/runs/:id/progress` untuk progres overall & per-klip.
- **Delete klip individual** — hapus 1 hasil render beserta artifact-nya tanpa menghapus seluruh run.
- **Settings** (`Settings.tsx`) — status lisensi + aktivasi, status dependency lokal, dan **input BYOK DeepSeek API key** (`/api/settings/deepseek-key`, disimpan di `settingsPath` per-device, dipakai `requireDeepSeekApiKey()` sebagai fallback dari `.env`).

### 3.4 Checkpoint & resumability

`CheckpointManager` (`src/pipeline/checkpoint.ts`) menyimpan progres ke SQLite (WAL mode) di 3 tabel: `pipeline_runs`, `stage_results`, `clip_progress`. Ini yang memungkinkan:

- Resume run yang crash tanpa mengulang stage yang sudah selesai.
- Dashboard web menampilkan status live dari sumber yang sama dengan CLI.
- Fase **awaiting selection** — pipeline berhenti setelah `IDENTIFY_CLIPS` sampai user memilih klip di web UI.

### 3.5 Penyimpanan data

| Lokasi                  | Isi                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `./data/runs/<run-id>/` | File perantara: download, transkrip, klip mentah, klip desilence, overlay caption  |
| `./output/<video-id>/`  | Hasil akhir MP4                                                                     |
| `./data/checkpoints.db` | Database SQLite                                                                     |
| `./models/`             | Model GGML Whisper                                                                  |

---

## 4. Batasan & Gap

Diamati langsung dari kode. Kolom **Risiko** = dampak kalau dibiarkan. Kolom **Kaitan Desktop App** menggantikan "Kaitan SaaS" di v2 — relevansinya terhadap jalur hybrid, bukan cloud multi-tenant.

| #            | Gap                                                                                                                                                                                                | Risiko                                                          | Kaitan Desktop App                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| G1           | **Single AI provider tanpa fallback** — `IDENTIFY_CLIPS` 100% bergantung DeepSeek; API down atau response bukan JSON valid = seluruh stage gagal. Tidak ada retry/backoff di `clip-identifier.ts`. | Tinggi — gagal di titik paling mahal (butuh transcript lengkap) | Blocker — makin penting karena BYOK berarti key tiap user beda, error handling harus jelas ke user awam |
| G2           | **Dashboard tanpa autentikasi** — siapa pun yang bisa akses port 3001 bisa buat/hapus run dan lihat video sumber.                                                                                  | Rendah di desktop app (localhost-only, 1 user per device)       | Berubah makna — jadi soal license-check, bukan lagi proteksi multi-user                                 |
| G3           | **Dokumentasi tidak sinkron** — `README.md` & `AGENTS.md` masih menyebut `GEMINI_API_KEY`/Google Gemini padahal kode sudah pindah ke DeepSeek.                                                     | Menengah — onboarding gagal                                     | —                                                                                                         |
| G4           | **Tidak ada publishing otomatis** — output berhenti di MP4 lokal.                                                                                                                                  | Menengah                                                         | Peluang Fase 2 (§7.2)                                                                                    |
| G5           | **Tidak ada test untuk `src/web/`** — logic penting (drag-resize caption, JSON import) tanpa test.                                                                                                 | Menengah                                                         | Blocker packaging — bug UI lebih mahal dideteksi setelah jadi installer                                 |
| G6           | **Tidak ada limit/queue lintas run** — hanya membatasi dalam 1 run.                                                                                                                                | Rendah di desktop single-user (1 device = 1 user aktif)          | Bukan blocker lagi di jalur hybrid                                                                       |
| G7           | **Tidak ada estimasi biaya/pemakaian API** — tidak ada tracking token/biaya DeepSeek per run.                                                                                                      | Rendah untuk billing kami (BYOK), tapi **tinggi untuk UX user**  | Peluang — tampilkan estimasi biaya API ke user supaya mereka bisa kontrol pemakaian key sendiri          |
| G8           | **Caption style statis per-render** — `CaptionStyle` ada di tipe & schema; kontrol style (font, size, warna, line spacing) sekarang **ada** di `CaptionEditor.tsx` (post-render). Sisa gap: kontrol ini belum muncul sebelum export pertama — lihat G15.                                     | Rendah–menengah                                                 | Sebagian besar selesai (brand kit, §7.1)                                                                 |
| G9 _(selesai)_ | ~~Tidak ada thumbnail/cover generator~~ — manual (upload/pilih frame) selesai lewat G19 (item #23); auto-generate dari frame terbaik selesai di item #12 (`extractBestFrameThumbnail` di `composer.ts`, dipanggil sebagai fallback default di `writeThumbnail`, `orchestrator.ts`). | Rendah | Selesai |
| G10          | **Whisper alignment bisa gagal diam-diam** — tanpa metric seberapa sering meleset.                                                                                                                 | Menengah — kualitas turun tanpa terdeteksi                      | Blocker QA — makin sulit didiagnosis lintas device berbeda-beda                                          |
| G11 _(baru)_ | **Belum ada mekanisme download dependency pasca-instalasi** — `yt-dlp`, `ffmpeg`, `whisper-cli`, model GGML masih diasumsikan sudah terpasang manual di sistem.                                    | Tinggi untuk jalur installer minimal                             | Blocker Fase 1 (§6.5)                                                                                    |
| G12          | **Selesai** — license/auth check terhadap cloud, lihat §5 item #7 dan `license-service/`.                                                                                   | —                                                            | —                                                                                          |
| G13 _(baru)_ | **Tidak ada konsep "Projects"** — pengelompokan run per channel/klien. Mockup desain (`design/.../projects_management`) mengasumsikan ini; tidak ada nav item, data model (`projectId`), atau route `/api/projects*` di kode. | Rendah — cosmetic sampai ada multi-channel user nyata | Peluang — relevan untuk persona solo repurposer yang pegang 1–3 channel (§1.2) |
| G14 _(baru)_ | **Tidak ada composed multi-clip timeline / audio track** — `RunDetail.tsx` cuma trim 1 klip di video sumber (`SourceVideoPlayer.tsx`), bukan menyusun beberapa klip terpilih + musik jadi satu timeline. | Menengah | Peluang besar, effort tinggi (L) |
| G15 _(revisi)_ | **Caption editor punya live preview, tapi hanya post-render** — `CaptionEditor.tsx` (uncommitted) sekarang render overlay + style di atas `desilenced.mp4` secara live, tapi hanya dapat diakses **setelah** klip pertama kali di-render (perlu `desilenced.mp4` sudah ada). Sebelum "Export Selected" pertama, user cuma memilih nama preset dari dropdown tanpa preview visual. | Rendah–menengah (turun dari Menengah — sebagian besar sudah dikerjakan) | Peluang, effort sisa kecil (S–M) — pindahkan preview yang sudah ada ke sebelum export (§1.5 langkah 3) |
| G16 _(baru)_ | **Buat run baru tanpa parameter/preview** — `POST /api/runs` cuma terima `youtubeUrl`/`existingVideoId`; tidak ada preview thumbnail YouTube, atau kontrol jumlah klip target/durasi/bahasa/tipe konten sebelum `IDENTIFY_CLIPS` jalan. | Rendah–menengah | Peluang UX, bukan blocker |
| G17 _(baru)_ | **Tidak ada targeting platform per klip** — `ClipCandidate`/`RenderedClip` tidak punya field platform (TikTok/Reels/Shorts); Library tidak bisa difilter per platform. | Rendah | Peluang, butuh keputusan produk dulu (1 output generik vs per-platform) |
| G18 _(baru)_ | **Tidak ada "Generate More Clips" atau undo/redo** — tidak ada endpoint untuk re-run `IDENTIFY_CLIPS` dengan kandidat tambahan pada run yang sudah `awaiting_selection`/`completed`; edit klip di `RunDetail.tsx` tidak punya undo/redo. **Diminta eksplisit oleh user (13 Agustus 2026)** — dinaikkan ke prioritas menengah, lihat §5. | Rendah, tapi UX blocking kalau AI hasilkan <5 kandidat bagus | Peluang, prioritas naik |
| G19 _(baru)_ | ~~Tidak ada tahap "Pre-Production" opsional~~ — **selesai**, lihat item #23 (§5): `PreProductionOptions` di `types.ts`, upload watermark/thumbnail via `POST /api/runs/:id/assets`, filter overlay ffmpeg di `composer.ts`, panel UI `PreProductionPanel.tsx` di `RunDetail.tsx`. | Rendah — fitur baru, bukan regresi | Selesai |
| G20 _(selesai)_ | **Default style caption selaras dengan referensi visual "jiang-clips"** — `DEFAULT_CAPTION_STYLE` (`pipeline/types.ts`) sekarang: Arial 52px, posisi center, `activeColor` #FFD700 (emas) di atas putih, `lineHeight` 1.1 (slider dicap 1.0–1.5, bukan 1–2). Render (`CaptionOverlay.tsx`) dan preview (`CaptionEditor.tsx`) sekarang selalu split kata jadi maksimal 2 baris tetap di titik tengah (`splitCaptionLines`, `pipeline/types.ts`) alih-alih wrap alami — fungsi dipakai bersama oleh render & preview supaya tidak terulang bug drift G21. Preset Pop/Minimal/Elegant (`captionPresets.ts`) sengaja tidak diubah — ini cuma default baru, preset lain tetap pilihan alternatif. | Rendah — preferensi visual, bukan bug | Selesai (`pipeline/types.ts`, `CaptionOverlay.tsx`, `CaptionEditor.tsx`, belum commit) |
| G21 _(revisi — selesai)_ | **Preview caption tidak sesuai hasil export** — root cause sebenarnya bukan nilai `lineHeight` default, tapi `CaptionEditor.tsx` (preview) menskalakan `fontSize`/`rowGap`/padding dengan konstanta tebakan tetap `/2.4`, sementara ukuran kotak preview di browser berubah-ubah mengikuti ukuran window/layar — tidak proporsional terhadap kanvas render asli 1080px (`src/remotion/index.tsx`). **Diperbaiki**: preview sekarang pakai CSS Container Query (`containerType: inline-size` + unit `cqw`) supaya setiap nilai px preview adalah pecahan eksak dari 1080px yang sama seperti render Remotion, di ukuran window berapa pun — plus tambah `maxWidth: 90%` yang tadinya cuma ada di render, tidak di preview (bisa bikin titik wrap baris beda). `lineHeight` default (1.2) & range slider (1–2) dibiarkan sesuai referensi jiang-clips di §5 item 25. | Menengah — keluhan langsung dari user | Selesai (`CaptionEditor.tsx`, belum commit) |

---

## 5. Roadmap Produk Saat Ini

### Sprint berikutnya (Fase 0 — hardening lokal, prasyarat sebelum packaging)

| #   | Item                                                                                                                 | Gap | Effort | Kenapa sekarang                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --- | ------ | -------------------------------------------------------------------------- |
| 1   | Sinkronkan `README.md` & `AGENTS.md` dengan kondisi kode aktual — **selesai** (tidak ada lagi referensi Gemini/`GEMINI_API_KEY`) | G3  | S      | Cepat, mencegah kebingungan onboarding                                  |
| 2   | Retry + exponential backoff + validasi JSON ketat untuk DeepSeek, dengan pesan error yang ramah untuk user BYOK awam — **selesai** (`clip-identifier.ts`: `callDeepSeek` backoff transport/5xx, `friendlyDeepSeekError` untuk auth/JSON) | G1  | S–M    | Pipeline paling rapuh; makin kritis karena user sendiri yang pegang key |
| 3   | Test coverage `src/web/` — endpoint API + logic non-trivial (drag-resize, JSON import parsing) — **selesai** (`CaptionEditor.test.ts`, `RunDetail.test.ts`, `server.test.ts`; 56 test lulus di seluruh repo) | G5  | M      | Fondasi sebelum dibungkus jadi desktop app                              |
| 4   | Tracking biaya/pemakaian API per run, ditampilkan ke user — **selesai** (`callDeepSeek` mengembalikan `tokenUsage`, ditampilkan di `RunDetail.tsx`) | G7  | M      | UX penting untuk model BYOK                                             |

### Fase 1 — Packaging desktop app (prioritas berikutnya setelah Fase 0)

| #   | Item                                                                                                                      | Gap | Effort |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --- | ------ |
| 5   | Bungkus `src/web/` sebagai UI Tauri — **selesai** (`src-tauri/src/lib.rs` spawn `bun run web` sebagai sidecar, buka webview ke `localhost`)                                                                                       | —   | L      |
| 6   | Mekanisme download dependency pasca-instalasi (`yt-dlp`, `ffmpeg`, `whisper-cli`, model GGML) dengan progress bar & retry — **selesai** (`dependency-installer.ts` retry+backoff, progress bar di `Setup.tsx`) | G11 | M–L    |
| 7   | License/auth check ke cloud (online-first, grace period offline) — **selesai** (client: `license.ts`: `checkLicense`/`activateLicense`, cache di `licenseCachePath`, grace period 7 hari, `LicenseGate.tsx` gate di `App.tsx`; backend: `license-service/`, Bun + SQLite, deploy di VPS pribadi di belakang Caddy dengan TLS otomatis, systemd untuk auto-restart/boot, key issue/revoke lewat CLI operator; hosting: `license.junaediakbar.web.id`) | G12 | M      |
| 8   | Auto-update installer — **selesai** (`tauri-plugin-updater` + `tauri-plugin-process`, cek saat startup, install-and-restart silent, endpoint GitHub Releases). Owner/repo GitHub di `tauri.conf.json` masih placeholder `YOUR_GITHUB_ORG/reel-farmer` — ganti begitu repo dipublikasikan; signing keypair digenerate lokal (privat tidak dikomit, publik ada di config) | —   | M      |
| 9   | Observability alignment — log/metric seberapa sering `alignToReference` jatuh ke fallback (lintas device) — **selesai** (`caption-generator.ts` log warning + runId/clipId saat fallback) | G10 | S      |

### Prioritas menengah (bisa paralel dengan Fase 1, tidak blocking)

Item #23–25 di bawah ini **diminta eksplisit oleh user pada 13 Agustus 2026**, bareng dengan menaikkan prioritas #22 (lihat tabel "Kandidat dari desain UI") — semuanya opsional dan tidak mengubah alur full-auto default (§1.5).

| #   | Item                                                                                          | Gap      | Effort |
| --- | ------------------------------------------------------------------------------------------------ | -------- | ------ |
| 10  | Preview sebelum render final — thumbnail/frame dari titik trim — **selesai**: drag handle trim di `ClipTimeline` sekarang seek live `SourceVideoPlayer` lewat `onScrub`/`videoRef` bersama, jadi frame di titik trim terlihat saat drag, bukan cuma lewat tombol "Preview start/end" | —        | M      |
| 11  | UI kontrol caption style (brand kit) di `CaptionEditor.tsx` — **sebagian besar selesai** (belum commit): preset Pop/Minimal/Elegant, kontrol font/size/weight/warna/line-spacing/outline/animate, live preview di atas `desilenced.mp4`. Sisanya: pindahkan ke sebelum export (lihat #24) | G8       | S (sisa) |
| 12  | Thumbnail/cover auto-generate dari frame terbaik — **selesai**: `extractBestFrameThumbnail` (`composer.ts`) pakai ffmpeg `-vf thumbnail` (scene-scoring, pilih frame paling representatif), dipanggil di `writeThumbnail` (`orchestrator.ts`) sebagai fallback saat user tidak upload/pilih frame manual di Pre-Production panel | G9       | M      |
| 23  | **Pre-Production panel (opsional)** — thumbnail kustom (upload/pilih frame), watermark (logo user, posisi & opacity diatur), ending watermark/outro (detik terakhir klip) — **selesai** (belum commit): `RunOptions`/`PreProductionOptions` di `types.ts`, upload asset via `POST /api/runs/:id/assets` (server mints filename, path-traversal guarded), filter overlay ffmpeg di `composer.ts` (`buildComposeFilterGraph`, unit-tested + verified end-to-end dengan ffmpeg nyata), panel UI di `PreProductionPanel.tsx` terpasang di `RunDetail.tsx` sebelum "Export Selected". Caption-edit re-compose (`regenerateCaptionOverlay`/`retranscribeCaptionOverlay`) membaca `preproduction.json` dari disk supaya watermark tidak hilang saat caption diedit ulang. | G19      | M–L    |
| 24  | Pindahkan live preview caption (dari #11) ke **sebelum** "Export Selected", bukan hanya post-render — user melihat style yang dipilih di atas video ter-trim sebelum render pertama jalan | G15      | S–M    |
| 25  | ~~Selaraskan default caption style dengan referensi visual (proyek "jiang-clips")~~ — **selesai**, lihat G20 | G20 | S      |

### Kandidat dari desain UI (`design/stitch_reel_farmer_saas/`), belum diimplementasikan

Ditemukan saat menyesuaikan `src/web/` dengan mockup desain (Agustus 2026) — restyle visual (warna/tipografi/rounded/shadow "Luminous Harvest") sudah diterapkan ke 6 screen yang sudah ada; item di bawah ini murni gap *fungsional* yang mockup asumsikan tapi kode belum punya. Kartu pricing/subscription di mockup `settings_trendy` **sengaja tidak diikuti** — bertentangan dengan keputusan BYOK + flat license (§0.1 #3, §8.1); Settings tetap menampilkan status lisensi flat + BYOK key, bukan tier berbayar.

| #   | Item                                                                                          | Gap | Effort |
| --- | ----------------------------------------------------------------------------------------------- | --- | ------ |
| 17  | Halaman "Projects" — kelompokkan run per channel/klien                                          | G13 | M      |
| 18  | Composed multi-clip timeline + pemilihan trending audio/music track di `RunDetail.tsx`           | G14 | L      |
| 19  | Live preview video+caption ter-render di `CaptionEditor.tsx` (di luar style controls G8/#11)     | G15 | M–L    |
| 20  | Preview YouTube (thumbnail/durasi) + parameter run (jumlah klip, durasi target, bahasa, tipe) saat membuat run baru | G16 | M      |
| 21  | Field & filter platform (TikTok/Reels/Shorts) per klip di Library                                | G17 | S–M    |
| 22  | Endpoint "Generate More Clips" pada run yang sudah selesai + undo/redo di editor klip. **Diminta eksplisit oleh user (13 Agustus 2026)** — sekarang termasuk prioritas menengah bareng #23–25, bukan lagi ditunda. | G18 | S–M    |

### Nice-to-have / tidak prioritas (eksplisit ditunda)

| #   | Item                                                                     | Catatan                                                                            |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 13  | **Radar Detector** (auto-watch channel, versi berbayar)                  | Lihat §7.2 — sengaja diberi label nice-to-have, bukan bagian sprint Fase 1/2 awal  |
| 14  | Auto-publish ke platform (TikTok/Shorts API)                             | Fase 2, §6.2                                                                        |
| 15  | Multi-provider `IDENTIFY_CLIPS`                                          | Hanya kalau reliability/biaya mendesak                                             |
| 16  | Analytics pasca-publish (view/retention) → feedback loop ke `viralScore` | Butuh auto-publish jalan dulu                                                       |

---

## 6. Jalur Menuju Hybrid Desktop App

### 6.1 Prinsip arsitektur

"SaaS" di sini berarti **software berlangganan/berlisensi yang jalan di device user**, dengan lapisan cloud tipis untuk identitas, lisensi, dan (nanti) Radar Detector — bukan platform cloud multi-tenant konvensional.

| Aspek         | Ditolak (full cloud)                                         | Dipakai (hybrid)                                                          |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Identitas** | `user_id`/`workspace_id` di semua tabel, row-level isolation | Akun untuk auth + license key saja                                         |
| **Storage**   | Object storage (S3/R2) untuk semua file                      | Tidak ada — semua file tetap di disk lokal user                            |
| **Compute**   | Worker terpisah + job queue di cloud                          | Tetap di device user (`ffmpeg`, `whisper-cli`, Remotion), dibungkus Tauri |
| **State**     | Postgres                                                       | SQLite lokal (tidak berubah)                                               |
| **Metering**  | Tracking menit/token per workspace untuk billing usage         | Tidak perlu — model bisnis BYOK + lisensi flat (§8)                        |

### 6.2 Fase bertahap

**Fase 0 — Hardening lokal** _(= §5, sprint berikutnya)_

**Fase 1 — Packaging Tauri + distribusi**

- UI: bungkus komponen `src/web/` yang sudah ada sebagai webview Tauri.
- Backend: `src/web/server.ts` tetap Bun, jalan sebagai proses internal app (sidecar Tauri), diakses webview via localhost seperti sekarang — tidak perlu rewrite besar.
- Dependency: lihat §6.5 (mekanisme download pasca-instalasi) — ini bagian paling berisiko di Fase 1, dapat perhatian khusus.
- License: validasi key saat startup + berkala, grace period offline (device tanpa internet tetap bisa kerja beberapa hari sebelum re-validasi wajib).
- **Radar Detector TIDAK termasuk Fase 1** — eksplisit ditunda (§7.2, §5).

**Fase 2 — Fitur cloud tipis (setelah Fase 1 stabil)**

- Radar Detector (§7.2) sebagai fitur berbayar pertama yang benar-benar butuh cloud jalan 24/7.
- Auto-publish/scheduler menyusul kalau divalidasi.

**Fase 3 — Kolaborasi/agensi (opsional, kalau divalidasi)**
Cloud sync, workspace, white-label — di atas fondasi desktop app, bukan migrasi paksa.

### 6.3 Kenapa Tauri

| Pertimbangan                       | Tauri                                                                                    | Electron                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Resource (RAM/binary size)**     | Jauh lebih hemat — pakai webview sistem (WebView2/WebKit), tidak bundle Chromium sendiri | Berat — setiap app bawa runtime Chromium sendiri         |
| **Cocok "middle budget komputer"** | Ya — beban tambahan di device user minimal                                                | Lebih membebani device lemah                              |
| **Ekosistem/kematangan**           | Lebih muda, komunitas lebih kecil                                                          | Lebih matang, lebih banyak referensi                       |
| **Bahasa backend native**          | Rust (untuk sidecar/native call) — kurva belajar baru kalau tim belum familiar             | Node.js — konsisten dengan stack Bun/TS yang sudah ada    |

**Keputusan**: Tauri dipilih murni untuk efisiensi resource, sesuai constraint budget compute user. Trade-off kurva belajar Rust diterima; sebagian besar logic bisnis tetap di backend Bun/TS yang sudah ada (dipanggil sebagai sidecar), Rust hanya untuk shell native & integrasi OS (file dialog, auto-update, dsb.) — meminimalkan area yang benar-benar butuh Rust baru.

### 6.4 Alur instalasi & dependency (baru — jawab G11)

Keputusan: **installer minimal, dependency diunduh setelah instalasi.**

| Tahap                        | Apa yang terjadi                                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Download installer**       | User unduh installer Tauri (`.exe`/`.dmg`/`.AppImage`) — ukuran kecil, hanya app shell + UI, tanpa `yt-dlp`/`ffmpeg`/`whisper-cli`/model.                                                                                                                                             |
| **Install**                  | Proses instalasi standar OS, cepat karena installer kecil.                                                                                                                                                                                                                            |
| **First-run / setup wizard** | App terbuka, mendeteksi dependency belum ada, mulai download otomatis: `yt-dlp`, `ffmpeg` (binary sesuai OS), `whisper-cli` + 1 model GGML default (ukuran model jadi pertimbangan UX — mulai dari model kecil/menengah sebagai default, model lebih besar sebagai upgrade opsional). |
| **Progress & resilience**    | Progress bar per-dependency, resume-if-interrupted (network putus di tengah download tidak mulai dari nol), verifikasi checksum sebelum dipakai.                                                                                                                                      |
| **Update dependency**        | Terpisah dari update app itu sendiri — `yt-dlp` khususnya sering perlu update mengikuti perubahan YouTube; app perlu cek versi dependency secara berkala, bukan hanya sekali di first-run.                                                                                            |

**Risiko yang perlu diawasi**: user dengan koneksi lambat/terbatas kuota bisa merasa "kena tipu" kalau installer kecil ternyata butuh download besar sesudahnya tanpa peringatan jelas. Mitigasi: tampilkan estimasi total ukuran unduhan **sebelum** first-run dimulai, bukan sesudah.

### 6.5 Risiko khusus jalur hybrid

| Risiko                                        | Kenapa relevan                                                          | Mitigasi awal                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Spesifikasi device user sangat bervariasi** | Whisper + ffmpeg + Remotion render butuh CPU/RAM cukup                  | Spesifikasi minimum eksplisit; deteksi kemampuan device saat first-run, beri estimasi waktu proses         |
| **First-run butuh download besar** (§6.4)     | Ukuran model GGML bisa signifikan                                       | Estimasi ukuran di muka, resume-if-interrupted, opsi pilih ukuran model                                    |
| **Distribusi & update lintas OS**             | Perlu installer Windows/Mac (Linux opsional), auto-update, code signing | Tauri punya tooling update bawaan; scope OS didukung dinyatakan eksplisit                                  |
| **Piracy / bypass license check**             | App offline-capable, validasi lisensi lebih mudah di-bypass             | Diterima sebagai trade-off wajar software desktop; jangan over-invest DRM sebelum ada bukti masalah nyata  |
| **Hak cipta konten sumber & ToS YouTube**     | `yt-dlp` tetap area abu-abu, sekarang jalan penuh di device user         | ToS eksplisit, dorong opsi upload file sebagai alternatif resmi                                            |
| **Dukungan (support) lebih sulit**            | Bug tergantung environment device (OS, versi dependency, GPU)           | Pin versi dependency yang didownload (bukan bergantung versi sistem), logging lokal yang mudah di-export   |

---

## 7. Kandidat Fitur — Disaring untuk Jalur Hybrid

### 7.1 Tetap relevan, murni lokal (tidak butuh cloud)

| Fitur                                                | Catatan                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Brand kit / template caption**                     | Disimpan di SQLite lokal, memanfaatkan `CaptionStyle` yang sudah ada di tipe (G8) |
| **Multi-language subtitle & dubbing**                | Proses lokal (Whisper multi-bahasa) atau via API BYOK untuk dubbing               |
| **A/B hook testing**                                 | Generate varian hook tetap proses lokal                                            |
| **Auto-reframe / speaker tracking**                  | Proses video tetap lokal                                                           |
| **Cover/thumbnail generator**                        | Proses lokal, menutup G9 — dibundel jadi 1 panel "Pre-Production" bareng watermark (G19) |
| **Watermark (brand milik user, opsional)**            | Proses lokal (filter overlay ffmpeg), menutup G19 — **berbeda dari watermark paksa tier-free** di §8.2: yang ini logo/brand user sendiri, bisa dipakai di tier manapun kalau user mau |
| **Ending watermark / outro card (opsional)**          | Proses lokal, bagian dari G19 — muncul di beberapa detik terakhir klip saja       |
| **Klip dari sumber non-YouTube (upload file, dsb.)** | Natural di jalur ini — file tetap di device user                                   |
| **Draft caption post & hashtag**                     | 1 panggilan AI ringan (BYOK)                                                       |

### 7.2 Radar Detector (baru — pengganti "auto-watch channel/RSS")

> **Status: nice-to-have, bukan prioritas Fase 1/2 awal.** Didokumentasikan sekarang supaya arsitektur cloud tipis (§6) sudah mempertimbangkan kebutuhannya, tapi tidak masuk sprint dekat.

**Konsep**: User memilih beberapa channel YouTube untuk "dipantau" (watch). Setiap 1 jam, sistem cek apakah ada video baru dari channel-channel tersebut. Kalau ada, user diberi tahu / video baru muncul sebagai kandidat run yang siap diproses — user tinggal buka app dan approve, bukan mulai dari nol cari & paste URL.

**Kenapa perlu cloud (bukan murni lokal)**: refresh tiap jam idealnya jalan walau app desktop sedang tertutup — kalau murni lokal, radar hanya jalan saat app dibuka, yang menghilangkan sebagian besar nilainya ("saya tidak perlu buka app tiap saat untuk tahu ada video baru").

**Desain yang disarankan (cloud tipis, scoped kecil)**:

| Bagian                                          | Di mana jalan                                                                               | Kenapa                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Cek channel baru (polling RSS/API tiap 1 jam)   | **Cloud**                                                                                    | Ringan (hanya metadata: judul, URL, tanggal upload), tidak butuh download/proses video sama sekali    |
| Daftar channel yang dipantau per user           | **Cloud** (terhubung ke akun/license)                                                       | Supaya polling bisa jalan lepas dari device menyala/tidak                                              |
| Notifikasi ada video baru                       | **Cloud → app** (push saat app dibuka, atau notifikasi OS kalau app resident di background) | —                                                                                                        |
| Download, transcribe, identify, extract, render | **Tetap di desktop app, device user**                                                       | Tidak berubah dari prinsip hybrid — cloud tidak pernah menyentuh video                                 |

**Implikasi produk**:

- Ini fitur **berbayar** (§8.2) — konsisten dengan keputusan awal, karena ini satu-satunya bagian produk yang benar-benar menambah beban server berkelanjutan (walau kecil) di sisi kami.
- Tidak butuh video/file transit ke cloud — hanya metadata channel & daftar video baru, jadi tetap sejalan dengan prinsip local-first (§1.4).
- Batas wajar per tier perlu ditentukan (mis. jumlah channel yang bisa dipantau di tier tertentu) — detail harga ditunda ke saat fitur ini benar-benar masuk roadmap aktif (lihat §5, item 13).

### 7.3 Berubah bentuk lainnya (cloud tipis, scoped kecil)

| Fitur                        | Kenapa butuh cloud                                          | Bentuk yang disarankan                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auto-publish + scheduler** | Publish terjadwal idealnya tidak tergantung device menyala   | Worker cloud khusus upload video **final** (bukan sumber) saat jadwal tiba; alternatif lebih sederhana: publish hanya jalan kalau app dibiarkan terbuka (device harus nyala) |
| **Team analytics dashboard** | Agregasi lintas klien/brand butuh titik pusat                | Fase 3, sejalan persona agensi/tim                                                                                                                                             |

### 7.4 Ditunda / tidak relevan di jalur ini

- **API publik + webhook** — bisa dipikir ulang sebagai "desktop app expose local API" untuk automation lokal, bukan cloud API.
- **White-label / sub-akun klien** — butuh fondasi multi-tenant yang sengaja tidak dibangun di Fase 1–2.
- **Template marketplace** — eksploratif, butuh backend sharing/discovery.
- **Workspace & kolaborasi** — butuh cloud sync yang sengaja dihindari di Fase 1–2.

---

## 8. Model Bisnis — BYOK + Lisensi Desktop App

### 8.1 Struktur harga

| Sumbu                                                           | Cocok karena                                                                             | Catatan                                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Lisensi/langganan software** (flat, per device atau per user) | Biaya kami hampir tetap (auth/license server ringan), tidak naik seiring pemakaian user   | Sumbu utama                                                                                                |
| **Add-on Radar Detector** (§7.2)                                | Satu-satunya fitur dengan beban server berkelanjutan                                       | Harga terpisah dari lisensi inti, atau termasuk di tier atas — didetailkan saat fitur ini aktif digarap  |
| **Seat** (Fase 3, agensi/tim)                                   | Cocok kalau ada fitur kolaborasi                                                            | Tunda sampai fitur kolaborasi ada                                                                          |
| ~~Kuota menit sumber / kredit~~                                 | Tidak relevan — compute ditanggung user                                                     | Dihapus dari model                                                                                         |

### 8.2 Kerangka tier (struktur, bukan harga final)

| Tier                             | Batas utama                            | Fitur pembeda                                                                       |
| ----------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| **Free/trial**                   | Watermark, limit jumlah klip per bulan | Fitur inti untuk dicoba                                                              |
| **Solo** (lisensi 1 device/user) | Tanpa watermark                        | Brand kit, multi-language, semua fitur §7.1                                          |
| **Pro**                          | Tetap 1 user                           | + Radar Detector (jumlah channel terbatas), scheduler/auto-publish kalau sudah ada  |
| **Agency** (Fase 3)              | Seat + workspace                       | Kolaborasi, white-label, analytics                                                   |

> **Catatan (13 Agustus 2026)**: watermark di baris "Free/trial" di atas adalah watermark **paksa "Reel Farmer"** untuk mendorong upgrade — bukan fitur yang sama dengan watermark opsional milik user sendiri (G19, §7.1). Keduanya independen: tier Solo/Pro ke atas menghilangkan watermark paksa produk, tapi watermark brand user sendiri (§7.1) tetap tersedia di semua tier kalau user mau memakainya.

### 8.3 Yang perlu diukur

| Yang perlu diukur                                                                  | Kenapa                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Biaya server auth/license                                                          | Margin dasar lisensi                                                                                                                                     |
| **Biaya polling Radar Detector** (baru)                                            | Walau ringan per-check, perlu diukur kalau jumlah user & channel yang dipantau banyak — ini biaya berkelanjutan pertama yang kami tanggung di model ini |
| Biaya distribusi (bandwidth installer + download dependency pasca-instalasi, §6.4) | Bisa signifikan karena model GGML besar; pertimbangkan CDN                                                                                                |
| Support cost per user (environment device bervariasi)                              | Sering jadi biaya tersembunyi di software desktop                                                                                                         |
| Willingness-to-pay vs kompetitor cloud gratis/freemium (CapCut, dsb.)              | Menentukan apakah flat license/langganan realistis                                                                                                        |

---

## 9. Metrik Keberhasilan

### 9.1 Metrik produk (lokal, tidak berubah)

Time to first clip, Selection rate, Edit rate, Re-render rate, Pipeline success rate — terukur via SQLite lokal, opsional di-share sebagai telemetry opt-in.

### 9.2 Metrik bisnis hybrid

| Metrik                                                       | Definisi                                                                                  | Kenapa penting                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Activation**                                               | % install yang menghasilkan ≥1 klip final dalam 7 hari pertama                            | Pengganti "activation workspace" ala cloud SaaS                                                    |
| **License conversion rate**                                  | % trial → paid                                                                              | Pengganti "retensi mingguan"                                                                       |
| **Device performance distribution**                          | Sebaran waktu proses per stage berdasar spek device (opt-in telemetry)                     | Validasi asumsi "middle budget komputer" cukup untuk UX layak                                      |
| **Dependency install success rate** _(baru)_                 | % first-run yang berhasil menyelesaikan download dependency tanpa gagal/retry berlebihan   | Langsung mengukur risiko G11/§6.4                                                                  |
| **Update adoption rate**                                     | % user di versi app terbaru                                                                 | Kesehatan distribusi/auto-update                                                                   |
| **Support ticket rate per environment**                      | Tiket dikelompokkan per OS/spek                                                             | Mengukur risiko dukungan lintas environment                                                        |
| **Radar Detector attach rate** _(baru, setelah fitur aktif)_ | % user Pro yang mengaktifkan Radar Detector                                                 | Validasi apakah fitur ini benar-benar alasan upgrade, bukan sekadar nice-to-have di atas kertas   |

### 9.3 Definisi "siap Fase 2"

Fase 1 dianggap siap naik ke Fase 2 (Radar Detector, auto-publish) kalau: app stabil di ≥2 OS utama, **dependency install success rate** tinggi secara konsisten, pipeline success rate stabil di device spek "middle budget" (bukan hanya mesin dev), auto-update terbukti bekerja tanpa gesekan, dan ada sinyal jelas dari user bahwa Radar Detector adalah kebutuhan nyata (bukan asumsi) — misalnya lewat request eksplisit atau riset kualitatif di Fase 1.

---

## 10. Referensi Kode & Glosarium

### 10.1 Peta kode (kondisi saat ini)

| Area                             | File                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline & stages                | `src/pipeline/orchestrator.ts`, `src/pipeline/types.ts`                                                                       |
| Checkpoint                       | `src/pipeline/checkpoint.ts`                                                                                                  |
| AI clip identification           | `src/modules/clip-identifier.ts`                                                                                              |
| Caption generation               | `src/modules/caption-generator.ts`, `src/remotion/CaptionOverlay.tsx`                                                         |
| Web dashboard (→ basis UI Tauri) | `src/web/server.ts`, `src/web/App.tsx`, `src/web/RunDetail.tsx`, `src/web/CaptionEditor.tsx`, `src/web/SourceVideoPlayer.tsx` |
| Konfigurasi                      | `src/config.ts`                                                                                                               |

### 10.2 Glosarium

| Istilah                | Arti                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Run**                | Satu eksekusi pipeline untuk 1 video sumber; punya `run-id` dan state tersimpan di SQLite                                                                          |
| **Stage global**       | Tahap yang dijalankan sekali per video (download, transcribe, identify)                                                                                             |
| **Stage per-klip**     | Tahap yang dijalankan per kandidat klip, paralel (extract, desilence, caption, compose)                                                                             |
| **Awaiting selection** | Status run yang berhenti setelah `IDENTIFY_CLIPS`, menunggu user memilih klip di UI                                                                                |
| **`ClipCandidate`**    | Hasil parsing DeepSeek: judul, hook line, start/end, alasan, `viralScore`, tags                                                                                    |
| **`viralScore`**       | Skor dari DeepSeek untuk mengurutkan kandidat; belum tervalidasi terhadap performa nyata                                                                            |
| **Desilence**          | Pembuangan jeda diam dari klip                                                                                                                                       |
| **Overlay**            | File WebM transparan berisi caption, di-compose di atas video                                                                                                        |
| **Alignment**           | Proses mencocokkan kata hasil Whisper ke transkrip referensi (`alignToReference`)                                                                                    |
| **Cloud tipis**        | Lapisan cloud minimal: auth/license + (nanti) Radar Detector — bukan compute pipeline                                                                                |
| **BYOK**                | Bring Your Own Key — user memasukkan API key AI sendiri; biaya AI ditanggung user                                                                                    |
| **Local-first**        | Data & compute utama tetap di device user secara default; cloud adalah opsi tambahan berbayar                                                                        |
| **Radar Detector**     | Fitur berbayar (nice-to-have): polling cloud tiap 1 jam untuk channel yang dipantau user, memunculkan video baru sebagai kandidat run tanpa user harus cek manual |
| **Sidecar**             | Proses backend (Bun/TS) yang dijalankan & dikelola oleh shell Tauri, diakses webview via localhost                                                                   |
| **Pre-Production**     | *(baru)* Tahap opsional sebelum `COMPOSE_REEL` untuk menambah thumbnail kustom, watermark, dan/atau ending watermark ke klip terpilih (G19)                        |

### 10.3 Riwayat perubahan

| Versi | Perubahan                                                                                                                                                                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.6   | Selesaikan item #7/G12: license backend berdiri sendiri di `license-service/` (Bun + SQLite, `POST /validate` sesuai kontrak `license.ts`), di-deploy ke VPS pribadi di belakang Caddy (TLS otomatis Let's Encrypt) sebagai systemd service, hosting `license.junaediakbar.web.id`. Key issue/revoke lewat CLI operator (`bun run issue-key`/`revoke-key`), tidak ada admin HTTP endpoint (single-operator, YAGNI). Diverifikasi end-to-end lewat domain publik: `bun test` 5/5 lulus lokal & di VPS, `/validate` key valid/unknown/revoked semua sesuai kontrak. |
| 4.3   | Permintaan user (13 Agustus 2026): tambah §1.5 "Alur aplikasi — target setelah perubahan ini"; tambah G19 (Pre-Production opsional: thumbnail, watermark, ending watermark) dan bedakan dari watermark paksa tier-free (§8.2); tambah G20 (default caption style belum selaras acuan visual "jiang-clips") dan G21 (line spacing `rowGap` berlebihan, root-cause di nilai default bukan mismatch preview/render); revisi G15 mengakui live preview + preset yang sudah dikerjakan di `CaptionEditor.tsx` (belum commit) tapi masih post-render saja; naikkan prioritas G18 "Generate More Clips" ke bagian "Prioritas menengah" (§5, item 23–25). |
| 4.4   | Perbaiki G21: diagnosis ulang — masalah utama bukan nilai `lineHeight`, tapi preview `CaptionEditor.tsx` menskalakan font/spacing dengan konstanta tebakan `/2.4` yang tidak proporsional ke ukuran window, jadi beda dari kanvas render asli 1080px. Ganti ke CSS Container Query (`containerType: inline-size`, unit `cqw`) supaya preview selalu pecahan eksak dari 1080px sama seperti export; tambah `maxWidth: 90%` yang sebelumnya cuma ada di render. Item #25 disempitkan (cuma sisa G20, spacing-mismatch di G21 sudah selesai). |
| 4.5   | Kerjakan item #25 (G20): ganti `DEFAULT_CAPTION_STYLE` ke Arial 52px/posisi center/emas #FFD700/`lineHeight` 1.1, cap slider line-spacing 1.0–1.5. Tambah `splitCaptionLines()` (`pipeline/types.ts`) sebagai satu-satunya sumber logika split-2-baris, dipakai bareng oleh `CaptionOverlay.tsx` (render) dan `CaptionEditor.tsx` (preview) supaya tidak berulang kelas bug G21 (preview & render drift). `bun test` 94 lulus, `tsc --noEmit` bersih. |
| 4.2   | Sesuaikan `src/web/` dengan mockup desain `design/stitch_reel_farmer_saas/` (restyle visual 6 screen + BYOK DeepSeek API key di Settings, §3.3). Tambah G13–G18 untuk gap fungsional yang mockup asumsikan tapi belum diimplementasikan (Projects, multi-clip timeline+audio, live caption preview, run-creation preview/params, platform filtering, generate-more/undo). Tolak kartu pricing subscription dari mockup Settings — bertentangan dengan keputusan BYOK (§0.1 #3). |
| 4.0   | Tetapkan Tauri sebagai framework, strategi installer minimal + download dependency pasca-instalasi (G11, §6.4), ubah auto-watch jadi Radar Detector sebagai fitur berbayar nice-to-have (§7.2), tambah G11/G12, update roadmap/metrik/model bisnis sesuai keputusan ini. Gabungkan seluruh bagian (1–10) jadi 1 dokumen utuh. |
| 4.1   | Tandai item Sprint Fase 0 (#1–#4) dan Fase 1 (#5, #6, #9) sebagai **selesai** di §5, sesuai kondisi kode aktual (dicek via `bun test`: 56 lulus). #7 (license/auth) tetap ditunda — belum ada keputusan arsitektur. |
| 3.0   | Tetapkan arah: hybrid desktop app + cloud tipis, prioritas solo repurposer, model bisnis BYOK.                                                                                                                                                                                                                                |
| 2.0   | Tambah TL;DR, daftar isi, Quick Start, persona & prinsip produk, tabel gap, jalur SaaS bertahap, kandidat fitur SaaS, model bisnis, metrik keberhasilan, glosarium                                                                                                                                                            |
| 1.0   | Dokumen awal: fitur saat ini, gap, saran pengembangan                                                                                                                                                                                                                                                                         |
