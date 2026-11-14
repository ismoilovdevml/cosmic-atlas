---
title: Gravitatsion toʻlqinlar
summary: Qora tuynuklar yoki neytron yulduzlar qoʻshilganda fazoning oʻzida tarqaladigan toʻlqinlar. 2015-yildan beri yuzlab shunday hodisa qayd etildi.
related: [black-hole, neutron-star, redshift, distance-uncertainty, galaxy]
sources:
  - LIGO Scientific Collaboration & Virgo Collaboration 2016, PRL 116, 061102, Observation of gravitational waves from a binary black hole merger (arXiv:1602.03837)
  - LIGO Scientific Collaboration & Virgo Collaboration 2017, PRL 119, 161101, GW170817 (arXiv:1710.05832)
  - LIGO, Virgo, Fermi GBM & INTEGRAL 2017, ApJL 848, L13, Gravitational waves and gamma-rays from a binary neutron star merger (arXiv:1710.05834)
  - Coulter et al. 2017, Science 358, 1556, Swope Supernova Survey 2017a (SSS17a), the optical counterpart to GW170817 (arXiv:1710.05452)
  - Cantiello et al. 2018, ApJL 854, L31, A precise distance to the host galaxy of GW170817 (arXiv:1801.06080)
  - Singer et al. 2016, ApJL 829, L15, Going the distance (3D sky maps, arXiv:1603.07333)
  - GWOSC, Gravitational Wave Open Science Center, cumulative GWTC event list, https://gwosc.org/eventapi/html/GWTC/ (CC BY 4.0, 2026-11-14 da oʻqildi)
  - LVK sky-map data releases on Zenodo, GWTC-2.1 (record 6513631), GWTC-3 (8177023), GWTC-4.1 (20275769), GWTC-5.0 (20348005)
  - Cosmic Atlas catalogue gw-events.json (scripts/build_gw.py)
updated: 2026-11-14
---

## Bu nima?

Massa fazo va vaqtni egadi. Ikki juda ogʻir va juda zich jism, masalan
[qora tuynuklar](doc:black-hole) yoki [neytron yulduzlar](doc:neutron-star), bir-birining atrofida
yaqin aylanib, oxiri qoʻshilganda fazoning oʻzini silkitadi. Bu silkinish yorugʻlik tezligida
**gravitatsion toʻlqinlar** boʻlib tarqaladi. Ularni Eynshteyn 1916-yilda bashorat qilgan.

Yerga yetib kelganda toʻlqinlar tasavvur qilib boʻlmaydigan darajada kuchsiz boʻladi: 4 km uzunlikdagi
detektor yelkasini proton kengligidan ham ancha kamroqqa choʻzadi va qisadi. AQShdagi ikki LIGO
detektori, Italiyadagi Virgo va Yaponiyadagi KAGRA buni oynalar orasida qaytadigan lazer nuri bilan
oʻlchaydi.

## Buni qayerdan bilamiz?

2015-yil 14-sentabrda ikkala LIGO detektori bir xil qisqa «chiyillash»ni yozib oldi: **GW150914**.
Taxminan 35 va 30 Quyosh massasiga ega ikki qora tuynuk qoʻshilib, taxminan 62 Quyosh massali bitta
qora tuynukka aylandi. Uch Quyosh massasi soniyaning bir qismida gravitatsion toʻlqin energiyasiga
aylanib ketdi.

Signalning oʻzi koʻp narsani aytadi:

- **Massalar** — chiyillash ohangi qanchalik tez koʻtarilishidan.
- **Masofa** — signal qanchalik kuchli ekanidan. Bu *yorqinlik masofasi*, shuning uchun atlas uni
  hamma joyda ishlatadigan hamharakat masofaga aylantiradi ([qizil siljish](doc:redshift)ga qarang).
- **Yoʻnalish** — faqat taxminan, detektorlar orasidagi juda kichik vaqt farqlaridan. Ikki-uch detektor
  bilan manba osmonning oʻnlab-minglab kvadrat gradusli boʻlagining istalgan joyida boʻlishi mumkin.

Yoʻnalish va masofani birlashtirsangiz, nuqta emas, **uch oʻlchamli hudud** hosil boʻladi. LIGO,
Virgo va KAGRA jamoalari uni osmonning har bir boʻlagi uchun masofa bahosi bilan birga osmon xaritasi
koʻrinishida eʼlon qiladi.

## Ajoyib, lekin rost

- **GW170817** (2017-yil 17-avgust) ikki neytron yulduz edi. Qoʻshilishdan 1,7 soniya oʻtib Fermi
  sunʼiy yoʻldoshi osmonning oʻsha qismidan gamma nurlar chaqnashini koʻrdi. Taxminan 11 soatdan keyin
  teleskoplar **NGC 4993** galaktikasida yangi yorugʻlik topdi: bu *kilonova* — oltin kabi ogʻir
  elementlarga boy, porlayotgan qoldiqlar. Bu hamon oʻz galaktikasi maʼlum boʻlgan yagona hodisa.
- GW170817 ning 90 % hududi taxminan **220 Mpk³**. Katalogdagi odatiy hodisaniki esa taxminan
  **10⁹ Mpk³** boʻlib, unga minglab galaktika sigʻadi. Shuning uchun koʻpchilik hodisaning
  galaktikasi nomaʼlum.
- Katalogdagi eng kuchli hodisa [GW250114_082203](#focus=GW250114_082203) (signal/shovqin nisbati
  78,6) taxminan 34 va 32 Quyosh massali ikki qora tuynuk boʻlib, eng birinchi hodisaga juda oʻxshaydi.

## Atlasda qayerda?

Atlas GWOSC katalog roʻyxatidagi massalari va masofalari oʻlchangan **282 ta hodisa**ni koʻrsatadi
(GWTC-1 dan GWTC-5.0 gacha). Har biri yumshoq, shaffof hajm boʻlib chiziladi: manba 90 % ehtimol
bilan shu hudud ichida; hajm LVK osmon xaritasidan bir nechta ellipsoid bilan olingan. **Yorliq
manbaning oʻzi emas**: u hajmning eng katta qismi markazini belgilaydi. Maʼlumot kartasi hajmni
Mpk³ da beradi. Koʻk hajmlar — ikki qora tuynuk, moviy-yashil — neytron yulduz va qora tuynuk,
tillarang — ikki neytron yulduz.

- [Gravitatsion toʻlqin manbalari hududlari](#layer=gw-volumes) qatlamini yoqing va 4 Gpk dan qarang.
- [GW170817](#focus=GW170817) oʻz galaktikasi [NGC 4993](#focus=NGC%204993) da, galaktikaning
  40,7 Mpk masofasida aniq turibdi (sirt yorqinligi tebranishlari usuli, Cantiello va boshq. 2018).
- [GW150914](#focus=GW150914) — birinchi qayd etilgan hodisa, taxminan 430 Mpk uzoqlikda (hamharakat).
- [GW190814](#focus=GW190814) — 2,6 Quyosh massali hamrohi bor qora tuynuk, eng aniq joylashtirilgan
  hodisalardan biri (taxminan 36 000 Mpk³).

Kartalardagi massalar — GWOSC dan olingan, 90 % oraliqli *manba tizimidagi* massalar. 90 % hajmlar
bu yerda ochiq osmon xaritalaridan qayta hisoblangan va LVK oʻzi eʼlon qilgan raqamlar bilan
(GWTC-2.1) 1 % dan yaxshiroq mos keladi.
