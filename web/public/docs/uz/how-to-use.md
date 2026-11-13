---
title: Atlasdan qanday foydalaniladi
summary: Burish uchun torting, yaqinlashtirish uchun gʻildirakni aylantiring yoki chimdang, nuqtani bosib kartasini oching. Qidiruv, qatlamlar, shkala va havolalar.
related: [index, units, distance-uncertainty, gaia-mission, desi-survey]
sources:
  - Cosmic Atlas source code, web/index.html, web/src/main.ts, web/src/nav/controller.ts, web/src/ui/rail.ts, web/src/tour/tours.ts, web/src/state/hash.ts
  - Cosmic Atlas, web/README.md (controls, search, deep links, tours, distance uncertainty)
  - Cosmic Atlas, docs/content-contract.md (languages, docs panel)
updated: 2026-11-13
---

## Harakatlanish

Atlas Quyoshdan milliardlab parseklargacha choʻzilgan yagona uzluksiz 3D sahna. Kamera doim
**fokus nuqtasi**ga qarab turadi, siz esa uning atrofida harakatlanasiz.

| Amal | Sichqoncha | Sensorli ekran | Klaviatura |
|---|---|---|---|
| Fokus atrofida aylanish | tortish | bir barmoq bilan tortish | strelkalar |
| Yon tomonga surish | oʻng tugma bilan yoki Shift bilan tortish | ikki barmoqni surish | |
| Kursor tomon yaqinlashish | gʻildirak | chimdish | + va − |
| Erkin uchish | | | W A S D, pastga va tepaga Q va E; Shift bosilsa 4 barobar tezroq |
| Nuqta haqida maʼlumot | bosish | teginish | |
| Nuqtaga uchib borish | ikki marta bosish | | |
| Qidiruv | | | / |
| Kartani yopish | | | Esc |

Yaqinlashish va uchish tezligi doim siz turgan masshtabga moslashadi: gʻildirakning bir pogʻonasi
taxminan 1,25 marta yaqinlashtiradi, shuning uchun sayyoralardan kosmik toʻrgacha bir necha aylantirishda
yetib borasiz. Pastki paneldagi dumaloq **Quyoshga qaytish** tugmasi sizni uyga olib keladi.

## Qidiruv

Qidiruv maydoniga yozing (yoki **/** tugmasini bosing). Atlasning oʻz kataloglaridagi nomlar darhol
chiqadi: Sirius kabi nomli yulduzlar, M31 kabi Messier va NGC obyektlari, yaqin galaktikalar. Katta-kichik
harf va boʻshliqlar ahamiyatsiz, boshqa nomlar ham ishlaydi (alf CMa Siriusni topadi). Kerakli
natijani strelkalar va Enter bilan tanlang.

Agar nom atlasda boʻlmasa, **CDS Sesame orqali qidirish** bandini tanlang: atlas SIMBAD, NED va VizieR
xalqaro nomlar xizmatidan soʻraydi. Sesame ishonchli masofa bersa (yulduz uchun yaxshi parallaks,
galaktika uchun qizil siljish), kamera oʻsha yerga uchadi. Bermasa, koʻrinish Quyoshdan obyekt tomonga
buriladi va «faqat yoʻnalish» deb yoziladi.

## Qatlamlar

**Qatlamlar** paneli maʼlumotlar toʻplamlarini yoqib-oʻchiradi va shaffofligini sozlaydi:
[Gaia yulduzlari](#layer=stars-gaia), [DESI](#layer=galaxies-desi), [2MRS](#layer=galaxies-2mrs),
[Cosmicflows-4](#layer=galaxies-cf4), [Mahalliy guruh](#layer=local-group) va
[Mahalliy hajm](#layer=local-volume), Somon Yoʻli modeli hamda Gaia butun osmon tasviri. Ularning ostida:

- **Ekspozitsiya** hammasini yulduz kattaliklarida yorqinroq yoki xiraroq qiladi.
- **Nuqtalar limiti** (0,5 dan 12 milliongacha, odatda 4 million) va **Tafsilot** sifat bilan tezlik
  oʻrtasida muvozanat beradi.
- **Yupqa qatlam** fokus orqali oʻtadigan yupqa qatlamni (±10 dan ±300 Mpk gacha) koʻrsatadi; bu
  [kosmik toʻr](doc:cosmic-web)ni koʻrishning eng yaxshi usuli.
- **Yorliqlar**, **Masofa noaniqligi** va **Unumdorlik paneli** alohida yoqiladi.

## Maʼlumot kartasi

Istalgan nuqtani bosing yoki unga teging. Karta uning nima ekanini, nomi yoki katalog raqamini, yulduz
kattaligini, rangi yoki [qizil siljishi](doc:redshift)ni, 16–84 % oraligʻi bilan masofasini, Galaktik va
osmon koordinatalarini hamda SIMBAD, Gaia arxivi yoki Legacy Surveys tasvirlariga havolalarni koʻrsatadi.
**Bu yerga uchish** sizni obyektga olib boradi. **Batafsil** shu turdagi obyekt haqidagi maqolani mana
shu hujjatlar panelida ochadi.

## Shkala, koʻrsatkich va sayohat

Pastdagi **masshtab chizigʻi** a.b., pk, kpk, Mpk yoki Gpk dagi uzunlikni va yorugʻlik uni qancha vaqtda
bosib oʻtishini koʻrsatadi. **Masshtab shkalasi** kamera masofasining chizgʻichi: taxminan 0,04 a.b. dan
30 Gpk gacha, «Proxima», «Milky Way», «Andromeda», «Cosmic web» kabi belgilar bilan. Uni bosing,
torting yoki ustida strelkalardan foydalaning (katta qadam uchun Shift). Yonidagi koʻrsatkich fokus
Quyoshdan qancha uzoqligini va uning nuri qachon yoʻlga chiqqanini aytadi
([oʻtmishga qarash vaqti](doc:lookback-time)).

**Masshtab sayohati** olti bekat boʻylab uchadi: Quyosh, Proxima Centauri, Quyosh atrofi, Somon Yoʻli,
Mahalliy guruh va kosmik toʻr, har birida izoh bor. Sichqoncha yoki klaviaturaga har qanday teginish
sayohatni toʻxtatadi.

## Havolalar va noaniqlik

Manzil satrida doim joriy koʻrinish, yoqilgan qatlamlar, yupqa qatlam va tanlangan obyektga olib
boradigan **chuqur havola** turadi. **Havolani nusxalash** tugmasi uni nusxalaydi: doʻstingiz aynan siz
koʻrgan manzarani ochadi. Tilni `?lang=uz`, `?lang=en` yoki `?lang=ru` bilan tanlash mumkin.

Tanlangan har bir obyekt koʻrish chizigʻi boʻylab 16 % dan 84 % gacha boʻlgan masofasini koʻrsatuvchi
**xatolik chizigʻi**ni oladi. Qatlamlar panelida *Masofa noaniqligi*ni belgilasangiz, yaqin nuqtalar
oʻz xatoligi boʻylab choʻziladi. Bu nimani anglatishini [masofa noaniqligi](doc:distance-uncertainty)
maqolasidan oʻqing.
