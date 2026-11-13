---
title: Oʻtmishga qarash vaqti
summary: Nur yoʻl bosishi uchun vaqt kerak, shuning uchun uzoq obyektlarni uzoq oʻtmishdagi holatida koʻramiz. Bu vaqt nur qachon yoʻlga chiqqanini bildiradi.
related: [redshift, units, desi-survey, quasar, cosmic-web]
sources:
  - Planck Collaboration 2020, A&A 641, A6, Planck 2018 results VI (arXiv:1807.06209); values below computed with astropy Planck18
  - NASA Science, Universe overview (CMB about 380,000 years after the Big Bang), https://science.nasa.gov/universe/overview/
  - Wang et al. 2021, A Luminous Quasar at Redshift 7.642, arXiv:2101.03179
  - NASA Sun Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html
  - Cosmic Atlas source code, web/src/math/units.ts and web/src/math/cosmology.ts
updated: 2026-11-13
---

## Bu nima?

Yorugʻlik dunyodagi eng tez narsa, lekin u bir zumda yetib kelmaydi. Quyoshdan kelishi uchun unga
taxminan 8 daqiqa, eng yaqin yulduzdan 4,2 yil, Andromeda galaktikasidan esa taxminan 2,6 million yil
kerak. Kosmosga qaraganingizda doim oʻtmishga qaraysiz.

**Oʻtmishga qarash vaqti** (lookback time) biz bugun qabul qilayotgan nur manbadan qancha vaqt oldin
yoʻlga chiqqanini bildiradi. Yaqin obyektlar uchun bu shunchaki yorugʻlik yillaridagi masofa: 100
yorugʻlik yili uzoqlikdagi yulduz nuri 100 yil oldin yoʻlga chiqqan.

Uzoq galaktikalarda masala murakkabroq, chunki nur yoʻlda boʻlgan paytda koinot kengaygan. Galaktika
hozir nur bosib oʻtgan yoʻldan ancha uzoqda. Shuning uchun astronomlar ikki sonni farqlaydi:
**oʻtmishga qarash vaqti** (nur qancha vaqt yoʻlda boʻlgan) va **birga harakatlanuvchi masofa**
(kengayishni toʻxtatib qoʻyish mumkin boʻlganda, galaktika bugun qanchalik uzoq boʻlardi).

## Buni qayerdan bilamiz?

Uzoq galaktika uchun uning [qizil siljishi](doc:redshift) z oʻlchanadi. Keyin kengayayotgan koinot
modeli z ni oʻtmishga qarash vaqtiga aylantiradi. Bu atlas Planck 2018 modelidan foydalanadi; unga
koʻra koinot yoshi 13,79 milliard yil. Baʼzi qiymatlar:

| Qizil siljish z | Oʻtmishga qarash vaqti | Oʻshanda koinot yoshi | Bugungi masofa |
|---|---|---|---|
| 0,1 | 1,3 milliard yil | 12,4 milliard yil | 0,43 Gpk |
| 1 | 7,9 milliard yil | 5,9 milliard yil | 3,40 Gpk |
| 3 | 11,6 milliard yil | 2,1 milliard yil | 6,50 Gpk |
| 6,8 | 13,0 milliard yil | 0,79 milliard yil | 8,74 Gpk |

Oxirgi qatorga eʼtibor bering: 13 milliard yil yoʻl bosgan nur hozir 8,74 Gpk, yaʼni taxminan
28,5 milliard yorugʻlik yili uzoqlikdagi joydan kelgan. Bunda ziddiyat yoʻq: bu vaqt davomida fazo
choʻzilib borgan.

## Ajoyib, lekin rost

- Biz koʻra oladigan eng qadimiy nur kosmik mikrotoʻlqinli fon nurlanishi (relikt nurlanish). U Katta
  portlashdan taxminan 380 000 yil oʻtib, koinot ilk bor shaffof boʻlganda tarqalgan.
- J0313−1806 kvazari (z = 7,64, 2021-yilda eʼlon qilingan) Katta portlashdan atigi 670 million yil
  keyingi holatida koʻrinadi. Uning qora tuynugi oʻshandayoq Quyoshdan 1,6 milliard marta ogʻir edi.
- Uzoq koinotning har bir «surati» turli davrlarni aralashtiradi. Atlasdagi bitta manzarada yaqin
  galaktikalar bir necha yuz million yil oldingi, eng uzoqlari esa 13 milliard yil oldingi holatida
  koʻrinadi.

## Atlasda qayerda?

Masshtab shkalasi ostidagi koʻrsatkichga qarang. 10 Mpk ichida u siz qarab turgan nuqtadan nur necha
yil oldin chiqqanini yozadi (masofa yorugʻlik tezligiga boʻlinadi). 10 Mpk dan uzoqda u Planck 2018
hisobiga oʻtadi va qizil siljishni ham koʻrsatadi. Galaktikani bossangiz, kartada uning «Lookback»
vaqti chiqadi.

[Masshtab sayohati](doc:how-to-use)ni boshlang: uning oxirgi bekati — kosmik toʻr — nur
[DESI](#layer=galaxies-desi) xaritasining narigi chekkasidan qachon yoʻlga chiqqanini aytadi. Keyin
[Andromeda galaktikasi](#focus=M31) (taxminan 2,6 million yil) bilan uzoq DESI kvazarlarini (taxminan
13 milliard yil) solishtiring.
