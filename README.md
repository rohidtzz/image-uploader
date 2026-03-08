# Storage API

API publik untuk upload file ke MinIO (S3-compatible). Upload file, dapat URL langsung — tanpa auth.

## Struktur

```
index.js
src/
  middleware/
    upload.js         ← multer + auto push ke MinIO
    errorHandler.js   ← centralized error handler
  services/
    storage.js        ← upload(), list()
.env
.env.example
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Jalankan MinIO via Docker

```bash
docker run -d \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  --name minio \
  minio/minio server /data --console-address ":9001"
```

Buka MinIO Console: http://localhost:9001

### 3. Buat bucket

Di MinIO Console (http://localhost:9001):
1. Login dengan `minioadmin` / `minioadmin`
2. Buat bucket baru, contoh: `mybucket`
3. Buka tab **Access Policy** pada bucket tersebut
4. Tempel policy berikut:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": { "AWS": ["*"] },
            "Action": ["s3:GetBucketLocation"],
            "Resource": ["arn:aws:s3:::mybucket"]
        },
        {
            "Effect": "Allow",
            "Principal": { "AWS": ["*"] },
            "Action": ["s3:ListBucket"],
            "Resource": ["arn:aws:s3:::mybucket"],
            "Condition": {
                "StringEquals": {
                    "s3:prefix": ["upload/public"]
                }
            }
        },
        {
            "Effect": "Allow",
            "Principal": { "AWS": ["*"] },
            "Action": ["s3:GetObject"],
            "Resource": ["arn:aws:s3:::mybucket/upload/public*"]
        }
    ]
}
```

> Ganti `mybucket` dengan nama bucket Anda yang sebenarnya.

### 4. Konfigurasi `.env`

Salin dari contoh:

```bash
cp .env.example .env
```

Isi sesuai setup MinIO Anda:

```dotenv
PORT=3000

MAX_FILE_SIZE=10485760
ALLOWED_TYPES=

AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_REGION=us-east-1
AWS_BUCKET=mybucket
AWS_FORCE_PATH_STYLE=true
AWS_ENDPOINT=http://localhost:9000
AWS_PUBLIC_URL=http://localhost:9000/mybucket
```

### 5. Jalankan server

```bash
npm run dev     # development (nodemon)
npm start       # production
```

---

## API

### `POST /upload`

Upload file. Gunakan `multipart/form-data` dengan field name `file`.

**Request:**
```bash
curl -F "file=@/path/to/foto.jpg" http://localhost:3000/upload
```

**Response `201`:**
```json
{
  "ok": true,
  "file": {
    "name": "foto.jpg",
    "type": "image/jpeg",
    "size": 204800,
    "key": "upload/public/a1b2c3d4e5f6.jpg",
    "url": "http://localhost:9000/mybucket/upload/public/a1b2c3d4e5f6.jpg"
  }
}
```

---

### `GET /upload`

List semua file yang sudah diupload.

**Request:**
```bash
curl http://localhost:3000/upload
```

**Response `200`:**
```json
{
  "ok": true,
  "total": 2,
  "files": [
    {
      "key": "upload/public/a1b2c3.jpg",
      "url": "http://localhost:9000/mybucket/upload/public/a1b2c3.jpg",
      "size": 204800,
      "lastModified": "2026-03-08T14:00:00.000Z"
    }
  ]
}
```

---

## Konfigurasi Upload

| Variabel | Default | Keterangan |
|---|---|---|
| `MAX_FILE_SIZE` | `10485760` (10MB) | Maksimal ukuran file dalam bytes |
| `ALLOWED_TYPES` | *(kosong)* | MIME types yang diizinkan, dipisah koma. Kosong = semua tipe boleh |

Contoh batasi hanya gambar:
```dotenv
ALLOWED_TYPES=image/jpeg,image/png,image/webp,image/gif
```

---

## Rate Limiting

100 request per 15 menit per IP. Error `429` jika terlampaui.
