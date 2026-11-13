---
title: Masofa noaniqligi
summary: Hech bir masofa mutlaq aniq emas. Atlas har bir nuqtaning ehtimoliy oraligʻini 16–84 % oraliq, 3D xatolik chizigʻi va choʻzilgan koʻrinishda beradi.
related: [parallax, redshift, gaia-mission, desi-survey, how-to-use]
sources:
  - Bailer-Jones et al. 2021, AJ 161, 147, Estimating distances from parallaxes V (doi:10.3847/1538-3881/abd806, arXiv:2012.05220)
  - Gaia DR3 overview (parallax precision), https://www.cosmos.esa.int/web/gaia/dr3
  - DESI Collaboration 2025, Data Release 1, arXiv:2503.14745
  - Huchra et al. 2012, ApJS 199, 26, 2MASS Redshift Survey (doi:10.1088/0067-0049/199/2/26)
  - Tully et al. 2023, ApJ 944, 94, Cosmicflows-4 (doi:10.3847/1538-4357/ac94d8)
  - Tully et al. 2014, The Laniakea supercluster of galaxies, arXiv:1409.0880 (peculiar velocities)
  - Cosmic Atlas, docs/data-contract.md, web/README.md, data/raw/*/PROVENANCE.json
updated: 2026-11-13
---

## Bu nima?

Har bir oʻlchangan masofaning xatoligi bor. Yulduz «taxminan 300 parsek uzoqlikda» boʻlishi mumkin,
lekin halol javob shunday: «katta ehtimol bilan 290 va 310 parsek orasida». Osmon xaritalari odatda
buni yashiradi va har bir yulduzni aniq nuqta qilib chizadi. Bu atlas noaniqlikni koʻrsatishga harakat
qiladi.

Har bir nuqta uchun uchta son saqlanadi: eng yaxshi baho (median) hamda **16- va 84-persentillar**.
Oddiy qilib aytganda, haqiqiy masofa shu ikki son orasida boʻlish ehtimoli taxminan 68 % ni tashkil
qiladi; bu qoʻngʻiroqsimon taqsimotdagi «plyus-minus bir standart chetlanish» kengligiga teng.

## Buni qayerdan bilamiz?

**Yulduzlar (Gaia).** Yulduzgacha masofa uning [parallaksi](doc:parallax)dan olinadi. Agar parallaks
xatoligi parallaksning 10 foizi boʻlsa, masofa xatoligi ham taxminan 10 foiz boʻladi; xiraroq va
uzoqroq yulduzlarda u tez oʻsadi. Bailer-Jones va hamkasblari (2021) 1,47 milliard Gaia yulduzining
parallakslarini ehtimollik usuli bilan masofaga aylantirishdi: har bir parallaks yulduzlar
Galaktikamizda qayerda boʻlishi ehtimoli koʻproq ekanini koʻrsatuvchi model bilan birlashtiriladi. Ular
median va 16- hamda 84-persentillarni eʼlon qiladi. Oraliq koʻpincha nosimmetrik boʻladi, yaʼni ikki
tomoni teng emas. Xarita tiniq boʻlishi uchun atlas faqat parallaksi xatoligidan kamida 10 marta katta
boʻlgan yulduzlarni koʻrsatadi.

**Galaktikalar (DESI, 2MRS).** Bu yerda masofa [qizil siljish](doc:redshift)dan olinadi. DESI qizil
siljishni juda aniq oʻlchaydi, shuning uchun oʻlchovning oʻz xatoligi kichik. Kattaroq muammo boshqa:
galaktikalar qoʻshnilari tortishi taʼsirida fazoda oʻzicha ham harakatlanadi. Bu «xususiy harakat»
kengayish ustiga qoʻshimcha Doppler siljishini qoʻshadi va kengayish taʼsiri hali kichik boʻlgan yaqin
galaktikalarda qizil siljish boʻyicha masofani buzib yuborishi mumkin. Shuning uchun atlas z = 0,003 dan
(taxminan 13 Mpk) yaqinroqda qizil siljish masofasidan foydalanmaydi va oʻrniga oʻlchangan masofalarni
oladi, masalan [Cosmicflows-4](#layer=galaxies-cf4) dan.

**Yaqin galaktikalar.** Mahalliy guruh va Mahalliy hajm galaktikalarigacha masofalar har biri oʻz
xatoligiga ega boʻlgan koʻplab turli usullardan yigʻilgan.

Maʼlumot kartasidagi DESI oraligʻi faqat qizil siljish oʻlchovining xatoligidan kelib chiqadi. Unda
yuqorida aytilgan xususiy harakatlar hisobga olinmagan, shuning uchun yaqin galaktikalarda haqiqiy
noaniqlik kattaroq.

## Ajoyib, lekin rost

- Masofadagi 10 foizlik xato obyektning haqiqiy yorqinligida 20 foizlik xatoga olib keladi, chunki
  yorqinlik masofa kvadratiga qarab kamayadi.
- 1 kpk uzoqlikdagi xira yulduzning (G = 20) parallaksi 1 yoy millisekundi, Gaia DR3 ning shu kattalikdagi
  odatiy xatoligi esa 0,5 yoy millisekundi: 50 foizlik xato. Bunday yulduzlar atlasning sifat
  saralashidan oʻtmaydi.
- Yorqin yulduzlar uchun Gaia DR3 0,02–0,03 yoy millisekundi aniqlikka erishadi, shuning uchun 1 kpk
  uzoqlikdagi yorqin yulduz masofasining xatosi atigi 2–3 foiz atrofida.

## Atlasda qayerda?

- **Maʼlumot kartasi:** yulduz yoki galaktikani bosing. Masofa ostida «16–84 % range» (16–84 %
  oraliq) va nisbiy xato, masalan ±3 % koʻrinadi. Agar faqat quyi chegara maʼlum boʻlsa, «no upper
  bound» (yuqori chegara yoʻq) deb yoziladi.
- **Xatolik chizigʻi:** tanlangan obyekt koʻrish chizigʻi boʻylab 16 % dan 84 % gacha boʻlgan masofani
  koʻrsatuvchi 3D chiziq oladi. Uzuq chiziq yuqori chegara yoʻqligini bildiradi.
- **Masofa noaniqligi rejimi:** Qatlamlar panelini oching va *Masofa noaniqligi* belgisini qoʻying.
  Koʻrinishning eng muhim qismlaridagi (bir vaqtda 32 tagacha tayl) nuqtalar koʻrish chizigʻi boʻylab
  qisqa chiziqchalarga choʻziladi, har birining uzunligi masofa oraligʻiga teng.
  [Gaia yulduzlari](#layer=stars-gaia)ga uzoqdan qarang: barcha chiziqchalar Quyoshga qarab turadi,
  chunki oʻlchov aynan shu yerdan qilingan.
