---
title: Tez radio chaqnash
summary: Boshqa galaktikadan keladigan, taxminan bir millisekund davom etadigan radio toʻlqinlar chaqnashi. Baʼzilari takrorlanadi, aksariyati faqat bir marta koʻrilgan.
related: [neutron-star, pulsar, galaxy, redshift, neutrino]
sources:
  - Lorimer et al. 2007, Science 318, 777, A Bright Millisecond Radio Burst of Extragalactic Origin (arXiv:0709.4301)
  - Spitler et al. 2016, Nature 531, 202, A repeating fast radio burst (arXiv:1603.00581)
  - Chatterjee et al. 2017, Nature 541, 58, A direct localization of a fast radio burst and its host (arXiv:1701.01098)
  - Macquart et al. 2020, Nature 581, 391, A census of baryons in the Universe from localized fast radio bursts (arXiv:2005.13161)
  - CHIME/FRB Collaboration 2020, Nature 587, 54, A bright millisecond-duration radio burst from a Galactic magnetar (arXiv:2005.10324)
  - Kirsten et al. 2022, Nature 602, 585, A repeating fast radio burst source in a globular cluster (arXiv:2105.11445)
  - Ryder et al. 2023, Science 382, 294, A luminous fast radio burst that probes the Universe at redshift 1 (arXiv:2210.04680)
  - CHIME/FRB Collaboration 2026, The Second CHIME/FRB Catalog, arXiv:2601.09399 (release 20251231)
  - FRBs/FRB repository (BSD-3-Clause), public_hosts.csv and FRBs_base.csv, https://github.com/FRBs/FRB
  - Cosmic Atlas, scripts/build_frb.py and data/tiles/catalogs/provenance/frb.json (counts)
updated: 2026-11-14
---

## Bu nima?

**Tez radio chaqnash** (inglizcha FRB) — taxminan sekundning mingdan bir ulushi davom etadigan yagona,
juda yorqin radio toʻlqinlar chaqnashi. Shu lahzada u Quyosh bir necha kunda chiqaradigan energiyacha
energiya chiqarishi mumkin. Deyarli barcha FRBʼlar boshqa galaktikalardan, yuzlab million va milliardlab
yorugʻlik yili naridan keladi.

Aksariyat FRBʼlar faqat bir marta koʻrilgan. Bir necha oʻntasi **takrorlanadi**: notekis oraliqlarda yana
chaqnaydi. Ularni nima hosil qilishi hali bahsli, ammo asosiy taxmin — **magnetar**, yaʼni oʻta kuchli
magnit maydonli yosh [neytron yulduz](doc:neutron-star).

## Buni qayerdan bilamiz?

Birinchi FRB 2007-yilda Dunkan Lorimer va uning talabasi Devid Narkevich tomonidan Parkes radioteleskopining
2001-yilgi arxiv maʼlumotlarida topilgan. Uning signali oʻziga xos tarzda yoyilgan edi: past radio
chastotalar yuqorilaridan kechroq yetib kelgan. Radio toʻlqinlarni fazodagi erkin elektronlar
sekinlashtiradi va kechikish yoʻldagi elektronlar soniga qarab ortadi. Bu son **dispersiya oʻlchovi**
(DM, pk sm⁻³ da) deyiladi. Yoʻlda bizning Galaktikamizdagidan ancha koʻp elektron bor edi, demak chaqnash
undan ancha tashqaridan kelgan.

2016-yilda FRB 20121102A takrorlanishi aniqlandi va bu radio massivlarga uni 2017-yilda 0,19
[qizil siljish](doc:redshift)dagi kichik mitti galaktikada aniq joylashtirish imkonini berdi. Oʻshandan
beri astronomlar yuzga yaqin FRBʼni oʻz xost galaktikalariga bogʻlab, xostlarning qizil siljishini
oʻlchashdi. Bu FRBʼlar DM masofa bilan ortishini koʻrsatdi. Ular sanaydigan elektronlar galaktikalar
orasida siyrak tarqalgan «yoʻqolgan» oddiy moddadir.

2020-yil aprelida bizning Galaktikamizdagi maʼlum magnetar SGR 1935+2154 zaif FRBʼga yaqin yorqinlikdagi
millisekundlik radio chaqnash chiqardi. Bu FRBʼlar bilan magnetarlar orasidagi birinchi bogʻliqlik boʻldi.

Harakatlanuvchi qismlari yoʻq Kanada teleskopi **CHIME** har kuni shimoliy osmonning katta qismini
koʻradi va deyarli har kuni yangi FRB topadi. Uning ikkinchi katalogida 3 641 manbadan 4 539 ta chaqnash,
jumladan 83 ta takrorlanuvchi manba bor.

## Ajoyib, lekin rost

- Eng yaqin maʼlum FRB — [FRB 20200120E](#focus=FRB%2020200120E) — 3,5 Mpk naridagi M81 galaktikasining
  qadimgi sharsimon yulduz toʻdasidan takrorlanadi: yosh magnetar kutiladigan joy emas.
- Xosti maʼlum eng uzoq FRB — [FRB 20220610A](#focus=FRB%2020220610A) — 1,016 qizil siljishda: uning
  chaqnashi taxminan 8 milliard yil yoʻl bosgan.
- FRB fotoapparat chaqnashidek qisqa davom etadi, ammo milliardlab yorugʻlik yili naridan qayd etiladi.

## Atlasda qayerda?

[Tez radio chaqnashlar qatlami](#layer=frb) FRBʼlarni pushti halqalar sifatida ikki xil koʻrsatadi:

- **Xost galaktikasining qizil siljishi maʼlum 101 ta FRB** 3D da, xost masofasida (Planck 2018
  kosmologiyasi) turadi. Ularning [kosmik toʻr](doc:cosmic-web) boʻylab tarqalganini koʻrish uchun bir
  necha Gpk gacha uzoqlashing yoki galaktikaga birinchi boʻlib bogʻlangan
  [FRB 20121102A](#focus=FRB%2020121102A) ga uching.
- **Qolgan 3 661 ta FRB** (CHIMEʼdan 3 579 ta va xost qizil siljishi yoʻq 82 ta lokalizatsiya qilingan)
  osmonda faqat **yoʻnalish**: ular osmon foni kabi cheksizlikda va faqat Quyosh yaqinida chiziladi.
  Ularning DM masofaga ishora qiladi, ammo uni masofaga aylantirish modelga bogʻliq, shuning uchun atlas
  masofa toʻqib chiqarmaydi. Takrorlanuvchilarning halqasi kattaroq. Ularning aksariyati CHIME koʻradigan
  shimoliy osmonda.

Halqani bosing: kartochkada DM, flyuens (yorqinlik × davomiylik, Jy ms da), takrorlanish-takrorlanmasligi
va 3D dagilar uchun xost galaktika koʻrsatiladi.
