---
title: Kosmik mikrotoʻlqinli fon
summary: Olamdagi eng qadimgi yorugʻlik: Katta portlashdan 380 000 yil oʻtib chiqqan. Planck uning mayda harorat tebranishlarini butun osmon boʻylab xaritaga tushirdi.
related: [redshift, lookback-time, cosmic-web, galaxy, units]
sources:
  - Penzias & Wilson 1965, ApJ 142, 419, A Measurement of Excess Antenna Temperature at 4080 Mc/s
  - Fixsen 2009, ApJ 707, 916, The Temperature of the Cosmic Microwave Background (arXiv:0911.1955)
  - Planck Collaboration 2020, A&A 641, A1, Planck 2018 results I, overview (arXiv:1807.06205)
  - Planck Collaboration 2020, A&A 641, A4, Planck 2018 results IV, diffuse component separation (SMICA map; arXiv:1807.06208)
  - Planck Collaboration 2020, A&A 641, A6, Planck 2018 results VI, cosmological parameters (z* = 1089.92; arXiv:1807.06209)
  - Planck Legacy Archive maps via IRSA, COM_CMB_IQU-smica_2048_R3.00_full.fits, https://irsa.ipac.caltech.edu/data/Planck/release_3/all-sky-maps/
  - Cosmic Atlas, scripts/build_cmb.py and web/public/sky/planck_smica_cmb.json (distance, age and map statistics computed with astropy Planck18)
updated: 2026-11-14
---

## Bu nima?

**Kosmik mikrotoʻlqinli fon** (KMF, inglizcha CMB; rus tilida «relikt nurlanish») yosh Olamdan qolgan
yorugʻlikdir. Dastlabki bir necha yuz ming yil davomida Olam qaynoq, nur sochayotgan zaryadli zarralar
tumani edi: yorugʻlik uzoqqa bora olmas, tezda erkin elektronga urilib qaytardi. Gaz taxminan 3 000 K
gacha soviganda elektronlar va protonlar birlashib neytral vodorodga aylandi va tuman tarqaldi. Oʻsha
paytda ozod boʻlgan yorugʻlik hanuzgacha yoʻlda.

Bu lahza **soʻnggi sochilish** deyiladi. U taxminan 1 090 [qizil siljish](doc:redshift)da yuz bergan:
Olam bugungidan 1 090 marta kichik va taxminan 380 000 yoshda edi (atlas foydalanadigan Planck 2018
kosmologiyasida 372 000 yil). Oʻshandan beri kengayish bu yorugʻlikni sargʻish-oq nurdan mikrotoʻlqinlarga
choʻzdi. Bugun u har tomondan keladigan, deyarli mukammal **2,7255 K** haroratli nurlanishdir.

## Buni qayerdan bilamiz?

1964–65-yillarda Arno Penzias va Robert Uilson Bell Labsʼdagi radio antennada har tomondan bir xil
keladigan va hech yoʻqolmaydigan zaif mikrotoʻlqinli shovqinni topishdi. Bu aynan shu fon edi; buning
uchun ular 1978-yilgi fizika boʻyicha Nobel mukofotini olishdi. Keyin sunʼiy yoʻldoshlar uni ancha aniq
oʻlchadi. COBE uning spektri deyarli mukammal absolyut qora jism spektri ekanini koʻrsatdi; haroratining
eng yaxshi qiymati 2,72548 ± 0,00057 K.

KMF mutlaqo bir tekis emas. Uning harorati joydan joyga taxminan 100 000 dan bir ulushga farq qiladi.
Planck xaritasida bu tebranishlarning odatiy kattaligi (rms) **107 µK**, yaʼni gradusning milliondan
bir ulushlari. Ular keyin paydo boʻlgan hamma narsaning urugʻi: biroz zichroq hududlar tortishish ostida
galaktikalarga va [kosmik toʻr](doc:cosmic-web)ga aylandi. ESAʼning Planck sunʼiy yoʻldoshi (2009–2013)
bu tebranishlarni butun osmon boʻylab xaritaga tushirdi va ularning naqshidan astronomlar Olamning yoshi,
tarkibi va kengayish tezligini oʻlchaydi.

Atlasdagi xarita Planckʼning SMICA xaritasi (2018-yil nashri). Somon yoʻli ham mikrotoʻlqinlarda yorqin
porlaydi, shuning uchun Planck uni toʻqqizta chastota kanalini birlashtirib olib tashlagan. Galaktika
tekisligi boʻylab ingichka yoʻlakda (osmonning 1,5 %) KMF tiklanmaydi, va Planck uni statistik jihatdan
mos naqsh bilan toʻldirgan: u yerda siz oʻlchovni emas, shu toʻldirishni koʻrasiz. Bizning fazodagi
harakatimiz osmonning bir yarmini ikkinchisidan taxminan 3,4 mK iliqroq qiladi (dipol); bu katta taʼsir
har qanday KMF xaritasidagidek olib tashlangan. Qizil oʻrtachadan iliqroq, koʻk sovuqroq, −300 dan
+300 µK gacha.

## Ajoyib, lekin rost

- KMF yorugʻlik bilan koʻra oladigan eng uzoq narsamiz. Uni chiqargan gaz hozir hamharakat masofada
  taxminan **13,9 Gpk** (45 milliard yorugʻlik yili) narida, garchi uning yorugʻligi atigi 13,8 milliard
  yil oldin yoʻlga chiqqan boʻlsa ham: yorugʻlik yoʻlda ekan, fazo kengayishda davom etdi
  ([orqaga qarash vaqti](doc:lookback-time)).
- Fazoning har bir kub santimetrida taxminan 410 ta KMF fotoni bor (2,7255 K haroratidan hisoblangan).
- Chiqarilgan paytda bu yorugʻlik taxminan 2 970 K (2,7255 K × 1 091) edi: oddiy choʻgʻlanma lampochka
  rangiga yaqin nur.

## Atlasda qayerda?

[KMF qatlami](#layer=cmb)ni yoqing va oxirigacha uzoqlashing. [Kosmik toʻr](doc:cosmic-web)dan oʻtib,
taxminan 8 Gpk dan narida **soʻnggi sochilish sirti** paydo boʻladi: atrofimizdagi, 1 090 qizil siljishning
hamharakat masofasidagi sfera (Planck 2018 kosmologiyasida 13 884 Mpk). U doim hamma narsaning ortida
chiziladi. Tashqaridan, 30 Gpk lik chegarada, ochiq old tomoni orqali uning uzoq ichki devorini (Yerdan
koʻrinadigan KMF osmoni) va yaqin devorning xira chizigʻini koʻrasiz. Raqamlari bilan kartochka uchun
uning yorligʻini bosing yoki [KMF](#focus=CMB) ga oʻting.

Bu sfera markazi biz, chunki har bir kuzatuvchining oʻz sferasi bor: bu shunchaki yorugʻlik bizgacha
yetib kela olgan eng uzoq masofa. Undan naridagi galaktikalar ham mavjud, faqat ularni yorugʻlik bilan
koʻra olmaymiz.
