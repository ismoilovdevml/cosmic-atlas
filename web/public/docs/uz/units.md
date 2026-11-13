---
title: Masofa birliklari
summary: Astronomlar fazoni astronomik birlik, yorugʻlik yili va parsekda oʻlchaydi. Bir parsek taxminan 3,26 yorugʻlik yili; butun atlas parsekda ishlaydi.
related: [parallax, lookback-time, distance-uncertainty, how-to-use]
sources:
  - IAU 2012 Resolution B2 (astronomical unit = 149,597,870,700 m), as adopted in astropy.constants.au
  - Mamajek et al. 2015, IAU 2015 Resolution B2, arXiv:1510.06262 (parsec defined as exactly 648000/π au)
  - Speed of light 299,792,458 m/s (exact, SI); Julian year 365.25 days (astropy.units)
  - NASA Sun Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html
  - Gaia DR3 parallax of Proxima Centauri, 768.0665 ± 0.0499 mas, VizieR I/355/gaiadr3
  - Cosmic Atlas source code, web/src/math/units.ts
updated: 2026-11-13
---

## Bu nima?

Kosmos uchun kilometr juda mayda birlik. Eng yaqin yulduzgacha boʻlgan masofani kilometrda yozsangiz,
oʻn toʻrt xonali son chiqadi. Shuning uchun astronomlar uchta kattaroq «chizgʻich» ishlatadi va bu
atlas uchalasini ham koʻrsatadi.

- **Astronomik birlik (a.b.).** Yerdan Quyoshgacha boʻlgan oʻrtacha masofa. 2012-yildan beri uning
  qiymati qatʼiy belgilangan: aynan 149 597 870 700 metr, yaʼni taxminan 150 million km. Quyosh tizimi
  ichida qulay birlik.
- **Yorugʻlik yili (y.y.).** Yorugʻlik boʻshliqda bir yilda (365,25 kunlik Yuliy yilida) bosib oʻtadigan
  masofa: taxminan 9,46 trillion km yoki 63 241 a.b. Bu vaqt emas, *masofa* birligi.
- **Parsek (pk).** Yulduzning [parallaksi](doc:parallax) roppa-rosa bir yoy sekundiga teng boʻladigan
  masofa. U aynan 648 000/π a.b. ga teng, yaʼni taxminan 206 265 a.b., 30,9 trillion km yoki
  **3,26 yorugʻlik yili**.

Kattaroq masshtablar uchun odatiy oldqoʻshimchalar qoʻshiladi: kiloparsek (kpk) 1 000 pk, megaparsek
(Mpk) bir million pk, gigaparsek (Gpk) bir milliard pk.

## Buni qayerdan bilamiz?

Avvallari astronomik birlik sayyoralar harakatidan oʻlchangan. Radar va kosmik apparatlarni kuzatish
uni shunchalik aniq qildiki, 2012-yilda Xalqaro astronomiya ittifoqi (IAU) uni shunchaki aniq metrlar
soni sifatida belgilab qoʻydi. Yorugʻlik tezligi ham SI tizimida aniq qiymatga ega (299 792 458 m/s),
shuning uchun yorugʻlik yili bevosita undan kelib chiqadi.

Parsek geometriyadan kelib chiqqan. Yer Quyosh atrofida aylanganda yaqin yulduz uzoq fonga nisbatan
biroz siljigandek koʻrinadi. Bu yillik siljishning yarmi parallaks burchagi deyiladi. Bir parsek
uzoqlikdagi yulduz bir yoy sekundiga siljiydi: bu taxminan 4 km narida turgan tanganing kengligi.
2015-yilda IAU parsekni astronomik birlikka bogʻladi, shuning uchun u ham endi aniq birlik.

## Ajoyib, lekin rost

- Quyosh nuri bizga taxminan 499 sekundda, yaʼni 8 daqiqadan sal koʻproq vaqtda yetib keladi. Siz
  Quyoshni 8 daqiqa oldingi holatida koʻrasiz.
- Hech bir yulduz bir parsekchalik yaqin emas. Eng yaqini Proxima Centauri ning Gaia oʻlchagan parallaksi
  768,07 yoy millisekundi, yaʼni u 1,30 pk (taxminan 4,25 yorugʻlik yili) uzoqlikda.
- Professional astronomlar parsekni yaxshi koʻradi, chunki u bevosita parallaks oʻlchovidan chiqadi:
  parsekdagi masofa = 1 / yoy sekundidagi parallaks. Yangiliklarda esa yorugʻlik yili koʻproq uchraydi.
- Atlasning masshtab shkalasi taxminan 0,04 a.b. dan 30 Gpk gacha boradi: bitta manzarada oʻnning
  20 dan ortiq darajasi.

## Atlasda qayerda?

Atlasda hamma narsa parsekda saqlanadi. Pastdagi masshtab chizigʻi birlikni oʻzi tanlaydi: Quyosh
yonida a.b., keyin pk, kpk, Mpk va Gpk. Chiziq ostida yorugʻlik bu masofani qancha vaqtda bosib
oʻtishi ham yoziladi, masalan «yorugʻlik kuni» yoki «ming yorugʻlik yili». Maʼlumot kartasi masofani
xuddi shu birliklarda koʻrsatadi, yulduzlar uchun qavs ichida yorugʻlik yilini ham qoʻshadi.

Sinab koʻring: [Proxima Centauri](#focus=Proxima%20Centauri) (1,30 pk), keyin [Sirius](#focus=Sirius)
(2,64 pk), [Hulkar](#focus=Pleiades) (135 pk), [Andromeda galaktikasi](#focus=M31) (0,78 Mpk) va
nihoyat milliardlab parsekka choʻzilgan [DESI](#layer=galaxies-desi) galaktikalariga uching. Bunday
masofalarda [oʻtmishga qarash vaqti](doc:lookback-time) haqida ham oʻqing: uzoq galaktikalar nuri juda
qadimiy.
