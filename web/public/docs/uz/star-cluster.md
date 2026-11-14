---
title: Yulduz toʻdasi
summary: Bitta bulutdan birga tugʻilgan yulduzlar. Tarqoq toʻdalar yosh va siyrak, sharsimon toʻdalar esa millionlab yulduzgacha boʻlgan qadimiy zich sharlar.
related: [star, milky-way, nebula, gaia-mission, interstellar-message]
sources:
  - Hunt & Reffert 2023, A&A 673, A114, Improving the open cluster census II (arXiv:2303.13424)
  - Hunt & Reffert 2024, A&A 686, A42, Improving the open cluster census III, cluster masses and bound/unbound classes (arXiv:2403.05143)
  - Baumgardt & Hilker 2018, MNRAS 478, 1520, masses and structural parameters of Milky Way globular clusters (Baumgardt globular cluster database, 4th version)
  - Baumgardt & Vasiliev 2021, MNRAS 505, 5957, Accurate distances to Galactic globular clusters (arXiv:2105.09526)
  - NASA Science, Hubble Messier catalog, Messier 45, https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-45/
  - NASA Science, Star clusters: inside the universe's stellar collections, https://science.nasa.gov/universe/star-clusters-inside-the-universes-stellar-collections/
  - National Geographic, 40 years ago, Earth beamed its first postcard to the stars, https://www.nationalgeographic.com/science/article/40-years-ago-earth-beamed-its-first-postcard-to-the-stars
  - Cosmic Atlas catalogue messier-ngc.json (OpenNGC, SIMBAD, Hunt & Reffert 2023, Baumgardt & Vasiliev 2021)
  - Cosmic Atlas catalogue clusters.json and the star-clusters layer (scripts/build_clusters.py)
updated: 2026-11-14
---

## Bu nima?

Yulduzlar kamdan-kam yolgʻiz tugʻiladi. Katta gaz va chang buluti bir vaqtda koʻplab yulduzga
aylanib siqiladi va ular bir muddat birga qolib, **yulduz toʻdasi**ni hosil qiladi. Toʻdadagi barcha
yulduzlarning yoshi, masofasi va dastlabki kimyoviy tarkibi deyarli bir xil, shuning uchun toʻdalar
yulduzlar hayotini oʻrganish uchun tabiiy laboratoriya.

Ikki asosiy turi bor:

- **Tarqoq toʻdalar** — [Somon Yoʻli](doc:milky-way) diskidagi oʻnlab-minglab yulduzdan iborat siyrak
  guruhlar. Ular yosh, odatda bir milliard yildan kichik, va boʻshroq bogʻlangan, shuning uchun yulduzlari
  asta-sekin tarqalib ketadi. Hulkar (Pleiades) mashhur misol.
- **Sharsimon toʻdalar** — oʻn minglab yulduzdan millionlab yulduzgacha boʻlgan zich, yumaloq toʻplamlar;
  ular Galaktika atrofidagi gardishda (halo) joylashgan. Ularning yulduzlari taxminan 8–13 milliard
  yil oldin paydo boʻlgan, yaʼni maʼlum eng qadimiy yulduzlar qatorida. Somon Yoʻlida 150 ga yaqin
  sharsimon toʻda maʼlum.

## Buni qayerdan bilamiz?

Toʻdani topish uchun fazoda bir-biriga yaqin turgan *va* osmon boʻylab birga harakatlanayotgan
yulduzlarni izlash kerak. [Gaia](doc:gaia-mission) aynan shuni oʻlchaydi. 2023-yilda Emili Xant va Sabine
Reffert klasterlash algoritmi bilan Gaia DR3 ning 729 million yulduzini koʻrib chiqib, **7 167 ta
toʻda** topishdi, jumladan 2 387 ta yangi nomzod va 134 ta sharsimon toʻda. Ularning qatʼiyroq
roʻyxatida 4 105 ta juda ishonchli toʻda bor. Ular eski kataloglardagi baʼzi toʻdalar aslida mavjud
boʻlmasligi mumkinligini ham aniqlashdi.

2024-yilda oʻsha mualliflar har bir toʻdani «tortib koʻrishdi» va oddiy savol berishdi: uning oʻz
tortishish kuchi uni birga ushlab tura oladimi? Faqat **5 647** tasi bu sinovdan oʻtdi va bogʻlangan
tarqoq toʻda hisoblanadi. **1 309** tasi *harakatlanuvchi guruhlar*: yulduzlari birga harakatlanadi,
lekin asta-sekin tarqalib ketmoqda. Quyosh yaqinida guruhlarning koʻpi aynan shunday: 250 pk ichida
taxminan toʻqqiztadan bittasigina bogʻlangan toʻda.

Sharsimon toʻdalar oddiy parallaks aniq boʻlishi uchun juda uzoq, shuning uchun Xolger Baumgardt va
Yevgeniy Vasilyev (2021) Gaia, Habbl va boshqa maʼlumotlarni birlashtirib, 162 ta sharsimon toʻdagacha
masofani oʻlchashdi; ulardan 20 ga yaqinining aniqligi 1 foiz yoki undan yaxshi.

## Ajoyib, lekin rost

- Hulkar yoki «Yetti opa-singil» toʻdasida mingdan ortiq yulduz bor. NASA uning taxminan 445 yorugʻlik
  yili masofasi «hamma tomonidan qabul qilinmagan» deb taʼkidlaydi. Atlas Xant va Reffert maʼlumotidan
  134,8 pk (440 yorugʻlik yili) qiymatini oladi.
- Xant va Reffert aʼzolar roʻyxatlarida koʻpincha «toʻlqin dumlari» uchraydi: toʻdadan qochib, undan
  uzoqqa choʻzilgan yulduzlar.
- 1974-yilda Aresibo radioteleskopi Yerdan yulduzlarga birinchi «otkritka»ni M13 sharsimon toʻdasi
  tomon yuborgan ([yulduzlarga xabarlar](doc:interstellar-message)).

## Atlasda qayerda?

[Yulduz toʻdalari qatlami](#layer=star-clusters) barcha **7 181** ta toʻdani nuqta qilib koʻrsatadi:
Xant va Reffert roʻyxati (keyinchalik galaktika yoki xato deb chiqarilgan 17 ta obyektsiz) va
Baumgardt maʼlumotlar bazasidagi 167 ta sharsimon toʻda. Yorqinroq nuqta — ogʻirroq toʻda, koʻkroq
nuqta — yoshroq toʻda; bu oʻlchangan rang emas, faqat koʻrsatish usuli. Ulardan 6 000 ga yaqini —
barcha bogʻlangan tarqoq toʻdalar, barcha sharsimon toʻdalar, Messier/NGC toʻdalari va 250 pk
ichidagi harakatlanuvchi guruhlar — yorliq va maʼlumot kartasiga ham ega: yoshi, aʼzo yulduzlar
soni, ularning yarmi sigʻadigan radius va massa. Sharsimon toʻdalar uchun Baumgardt va Vasilyev
masofalari olinadi, chunki ular yolgʻiz Gaia parallakslaridan aniqroq. Yoshlar aʼzo yulduzlarning
ranglarini moslashtirib topilgan va ikki baravargacha farq qilishi mumkin (kartadagi oraliqqa
qarang). Mana bular:

- [Giadalar (Hyades), Melotte 25](#focus=Melotte%2025), eng yaqin tarqoq toʻda, 47 pk da, taxminan
  580 million yoshda;
- [Hulkar, M45](#focus=M45), 135 pk dagi tarqoq toʻda, taxminan 120 million yoshda;
- [Oxur (Beehive), M44](#focus=M44), 183 pk dagi tarqoq toʻda;
- [Qoʻsh toʻda h va χ Persey, NGC 869](#focus=NGC%20869) va [NGC 884](#focus=NGC%20884), 2,3 kpk da
  yonma-yon turgan ikki yosh (taxminan 18 million yillik) toʻda;
- [Gerkules toʻdasi, M13](#focus=M13), 7,42 kpk dagi sharsimon toʻda;
- [Omega Sentavr, NGC 5139](#focus=NGC%205139), 5,43 kpk dagi sharsimon toʻda;
- [47 Tukan, NGC 104](#focus=NGC%20104), 4,52 kpk dagi sharsimon toʻda.

Hulkar atrofidagi [Gaia yulduzlari](#layer=stars-gaia)ga qarang: uning aʼzolari bir xil masofadagi
zich guruh boʻlib ajralib turadi. Baʼzi yosh toʻdalar hali oʻzlari tugʻilgan gaz bilan oʻralgan,
masalan [Orion tumanligi](#focus=M42)da ([tumanlik](doc:nebula)).
