# ALERT AI — Yayınlama rehberi (0 TL)

Bu site üç ücretsiz parçadan oluşur:
- **Cloudflare Workers:** Siteyi barındırır ve yapay zekâ isteklerini güvenle iletir.
- **Supabase:** Hesaplar (e-posta ile giriş) ve veritabanı.
- **Google Gemini:** Yapay zekâ ve seslendirme. Ücretsiz anahtar kullanılır, kredi kartı gerekmez.

Toplam süre yaklaşık 20 dakika. Bir yerde takılırsan ekran görüntüsü at.

---

## 1) Gemini anahtarını al (2 dk)
1. https://aistudio.google.com/apikey adresine Google hesabınla gir.
2. **Create API key** düğmesine bas ve anahtarı bir yere kopyala.
3. ⚠️ Google Cloud'da **Billing (faturalandırma) açma.** Kapalı olduğu sürece ücret kesilemez. Sınır dolarsa site "kota doldu" der, para çekmez.

## 2) Supabase'i hazırla (7 dk)
1. https://supabase.com → **New project**. Adı `alertai`, bölge Frankfurt veya Stockholm olsun. Güçlü bir veritabanı şifresi yaz.
2. Proje açılınca sol menüden **SQL Editor** → **New query**.
3. Bu klasördeki **`schema.sql`** dosyasının içeriğinin tamamını yapıştır ve **Run**'a bas. "Success" yazmalı.
4. Sol menü → **Authentication** → **Sign In / Providers** → **Email** açık olmalı (varsayılan olarak açıktır).
   - Supabase'in ücretsiz e-posta gönderimi saatte birkaç e-postayla sınırlı. Bu yüzden başlangıçta **"Confirm email"** seçeneğini **kapatman** önerilir; böylece öğrenciler kayıt olur olmaz giriş yapar.
5. **Project Settings → Data API** (veya **API Keys**) sayfasından iki değeri kopyala:
   - **Project URL** (örnek: `https://abcd1234.supabase.co`)
   - **anon / public** anahtar (uzun bir metin). Bu anahtar herkese açık olabilir; gizli olan `service_role` anahtarını **kullanma.**

## 3) Dosyaları GitHub'a yükle (5 dk)
1. https://github.com/new → depo adı `alert-ai` → **Create repository**.
2. **uploading an existing file** bağlantısına tıkla. Zip'ten çıkan klasörün **içindeki** tüm dosya ve klasörleri sürükle (`public`, `src`, `wrangler.jsonc`, `schema.sql`, `package.json`…).
3. **Commit changes**'a bas.
4. GitHub'da **`wrangler.jsonc`** dosyasını aç, kalem simgesine bas ve şu iki satırı doldur:
   ```
   "SUPABASE_URL": "https://abcd1234.supabase.co",
   "SUPABASE_ANON_KEY": "eyJhbGciOi...uzun-anahtar..."
   ```
   Sonra **Commit changes**'a bas.

## 4) Cloudflare'de yayınla (5 dk)
1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Import a repository**.
2. GitHub hesabını bağla ve `alert-ai` deposunu seç. Ayarları olduğu gibi bırakıp **Deploy**'a bas.
3. Yayın bitince Worker'ın sayfasında **Settings → Variables and Secrets → Add**:
   - Type: **Secret**, Name: `GEMINI_API_KEY`, Value: 1. adımda aldığın anahtar → **Deploy**.
4. Site adresin şöyle görünür: `https://alert-ai.<kullanıcı-adın>.workers.dev`.
5. Supabase'e dön: **Authentication → URL Configuration → Site URL** alanına bu adresi yaz ve kaydet. Böylece e-posta bağlantıları doğru siteye gider.

Bitti! Siteye girip hesap oluştur, hedef notunu yaz ve yolunu başlat.

> GitHub'da bir dosyayı her değiştirdiğinde Cloudflare siteyi otomatik olarak yeniden yayınlar.

---

## Bilinmesi gerekenler
- **Seslendirme:** Gemini'nin doğal sesli TTS modeli kullanılır. Kore, Puck, Aoede ve diğer 12 ses arasından Profil veya Podcast sayfasında seçim yapılır. Bu modelin ücretsiz günlük kotası **küçüktür**. Kota dolunca site otomatik olarak tarayıcının kendi sesine geçer ve bunu açıkça söyler. Üretilen sesler tarayıcıda saklanır; aynı podcast tekrar açılınca kota harcanmaz.
- **Ücretsiz sınırlar:** Gemini'nin dakikalık ve günlük istek sınırları vardır (güncel değerler AI Studio'da görünür). Cloudflare Workers ücretsiz planı günde 100.000 isteğe kadar yeterlidir. Supabase ücretsiz planı 500 MB veritabanı sağlar; ayrıca 1 hafta hiç kullanılmayan projeler duraklatılır ve panelden tek tıkla yeniden açılır.
- **Gizlilik:** Gemini ücretsiz katmanında Google istekleri modellerini geliştirmek için kullanabilir. Öğrencilerin kişisel bilgi içeren belge yüklememesi önerilir.
- **Güvenlik:** Herkes yalnızca kendi verisini görebilir (veritabanı satır güvenliği). Gemini anahtarı sunucuda saklanır, tarayıcıya hiç gitmez. Yapay zekâyı yalnızca giriş yapmış kullanıcılar kullanabilir.
- **Desteklenen materyaller:** PDF (metinli), TXT ve fotoğraf (el yazısı dahil). Taranmış PDF'ler için sayfa fotoğrafı yüklenmelidir.

## Bilgisayarında denemek (isteğe bağlı)
```bash
npm install
# .dev.vars adında bir dosya oluştur ve içine: GEMINI_API_KEY=anahtarın
npx wrangler dev
```
Supabase değerleri boşsa site **"Yerel deneme modu"**nda açılır: hesaplar yalnızca o tarayıcıda saklanır. Yerelde yapay zekâyı kullanmak için `.dev.vars` dosyasına `DEV_ALLOW_ANON=1` satırını da ekle.
