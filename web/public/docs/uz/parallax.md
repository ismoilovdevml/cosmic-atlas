---
title: Parallaks
summary: Yaqin yulduzning uzoq yulduzlar fonida har yili biroz siljishi. Shu burchakni oʻlchab, yulduzgacha masofani sof geometriya bilan topamiz.
related: [units, gaia-mission, distance-uncertainty, star]
sources:
  - Reid & Menten 2020, The First Stellar Parallaxes Revisited, arXiv:2009.11913
  - Gaia DR3 overview (precision, numbers), https://www.cosmos.esa.int/web/gaia/dr3
  - Gaia DR3 parallax of Proxima Centauri, 768.0665 ± 0.0499 mas, VizieR I/355/gaiadr3
  - Bailer-Jones et al. 2021, AJ 161, 147 (doi:10.3847/1538-3881/abd806)
  - Mamajek et al. 2015, IAU 2015 Resolution B2, arXiv:1510.06262
  - Cosmic Atlas, scripts/fetch_gaia.py (cut parallax_over_error > 10, RUWE < 1.4)
updated: 2026-11-13
---

## Bu nima?

Barmogʻingizni koʻzingiz oldiga tutib, avval bir koʻz, keyin ikkinchi koʻz bilan qarang. Barmoq fonga
nisbatan sakrab ketadi. Mana shu sakrash **parallaks**, miyangiz undan masofani chamalash uchun
foydalanadi.

Astronomlar ham xuddi shunday qiladi, faqat koʻz oʻrniga Yer orbitasining ikki chekkasidan
foydalanadi. Yanvar va iyulda Yer Quyoshning qarama-qarshi tomonlarida, bir-biridan taxminan
300 million km uzoqlikda boʻladi. Shu ikki joydan qaralganda yaqin yulduz ancha uzoqroq yulduzlarga
nisbatan sal siljiydi. Bu yillik siljishning yarmi parallaks burchagi *p* deyiladi. Burchak qancha
kichik boʻlsa, yulduz shuncha uzoq.

Qoida oddiy: **parsekdagi masofa = 1 / yoy sekundidagi parallaks.** Parallaksi 0,1 yoy sekundi boʻlgan
yulduz 10 parsek uzoqlikda. [Parsek](doc:units) aynan shuning uchun bor: bu parallaksi bir yoy
sekundiga teng yulduzgacha boʻlgan masofa.

## Buni qayerdan bilamiz?

Bu burchaklar juda kichik. Hatto eng yaqin yulduz Proxima Centauri ham bir yoy sekundidan kam siljiydi:
uning Gaia oʻlchagan parallaksi 768,07 yoy millisekundi (sekundning mingdan bir ulushlari), bu
1,30 pk degani. Koʻpchilik yulduzlarning parallaksi bundan minglab marta kichik.

Birinchi yulduz parallakslari 1830-yillarda oʻlchangan. Fridrix Bessel 1838-yilda 61 Oqqush (61 Cygni)
yulduzining parallaksini eʼlon qildi, deyarli shu paytlarda Tomas Xenderson (Alfa Sentavr) va Fridrix
fon Struve (Vega) ham oʻz natijalarini chop etdi. Bungacha yulduzlar qanchalik uzoqligini hech kim
bilmasdi.

Bugun bu sohada Yevropa kosmik agentligining [Gaia](doc:gaia-mission) yoʻldoshi peshqadam. Gaia DR3
1 467 744 818 ta manbaning parallaksini beradi. Yorqin yulduzlar (G < 15) uchun odatiy xatolik atigi
0,02–0,03 yoy millisekundi, G = 20 da esa taxminan 0,5 yoy millisekundi.

Har bir oʻlchovning xatoligi bor, xira yoki juda uzoq yulduzlarda esa xatolik parallaksning oʻzicha
boʻlishi mumkin. Unda «1 / parallaks» maʼnosiz natija beradi. Bailer-Jones va hamkasblari (2021) bu
muammoni statistika bilan hal qilishdi: har bir parallaksni Galaktikamiz modeli bilan birlashtirib,
1,47 milliard yulduz uchun eng ehtimoliy masofa va uning oraligʻini eʼlon qilishdi.
[Masofa noaniqligi](doc:distance-uncertainty) maqolasiga qarang.

## Ajoyib, lekin rost

- Fon Struve dastlab Vega parallaksini 0,125 yoy sekundi deb eʼlon qildi, keyin koʻproq maʼlumot bilan
  uni ikki baravar oshirdi. 2020-yilda uning maʼlumotlari qayta tahlil qilinganda sababi ochildi: u
  oʻlchagan ikki yoʻnalish bir-biriga mos kelmagan va faqat tasodifan birgalikda toʻgʻri javob bergan.
- Parallaks faqat Somon Yoʻlining yaqinroq qismlari uchun ishlaydi. Boshqa galaktikalar uchun burchaklar
  juda kichik, shuning uchun astronomlar [qizil siljish](doc:redshift) kabi boshqa usullardan
  foydalanadi.
- Gaia har bir yulduzning parallaksi bilan bir vaqtda uning osmon boʻylab harakatini ham oʻlchaydi.

## Atlasda qayerda?

[Gaia yulduzlari](#layer=stars-gaia) qatlamida faqat parallaksi oʻz xatoligidan kamida 10 marta katta
(va astrometrik yechimi yaxshi, RUWE < 1,4) boʻlgan, 1 kpk gacha boʻlgan yulduzlar bor. Ularning
masofalari Bailer-Jones geometrik masofalari. Istalgan yulduzni bosing: kartada uning median masofasi
va 16–84 % oraligʻi chiqadi, 3D chiziq esa shu oraliqni koʻrish chizigʻi boʻylab koʻrsatadi.

Yaqin yulduz [Barnard yulduzi](#focus=Barnard%27s%20Star)ni (1,83 pk, Gaia) uzoqdagi yorqin
[Deneb](#focus=Deneb) bilan solishtiring: uning katalogdagi masofasi (433 pk) eskiroq Hipparcos
yoʻldoshidan olingan, chunki Gaia bunchalik yorqin yulduzlarni oʻlchay olmaydi.
