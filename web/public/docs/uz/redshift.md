---
title: Qizil siljish
summary: Uzoq galaktikalar nuri bizga choʻzilib, uzunroq, qizilroq toʻlqinlarda yetib keladi. Bu choʻzilish, z, nur kengayayotgan fazoda qancha yoʻl bosganini aytadi.
related: [lookback-time, desi-survey, quasar, cosmic-web, distance-uncertainty]
sources:
  - Hubble 1929, PNAS 15, 168, A Relation Between Distance and Radial Velocity Among Extra-Galactic Nebulae, https://pmc.ncbi.nlm.nih.gov/articles/PMC522427/
  - Planck Collaboration 2020, A&A 641, A6, Planck 2018 results VI (arXiv:1807.06209); astropy Planck18 used for the distances below
  - DESI Collaboration 2025, Data Release 1, arXiv:2503.14745
  - Kellermann 2013, The Discovery of Quasars and its Aftermath, arXiv:1304.3627
  - Cosmic Atlas, data/raw/galaxies-desi/PROVENANCE.json (redshift histogram of the DESI layer)
updated: 2026-11-13
---

## Bu nima?

Har bir kimyoviy element nurni oʻziga xos toʻlqin uzunliklarida yutadi va chiqaradi, xuddi shtrix-kod
kabi. Astronomlar uzoq galaktika nurini spektrga yoyganda bu shtrix-kodni taniydi, lekin u
laboratoriyadagiga qaraganda uzunroq toʻlqinlarda, yaʼni qizil tomonga surilgan holda turadi. Bu
**qizil siljish**.

U bitta son bilan oʻlchanadi:

**z = (kuzatilgan toʻlqin uzunligi − laboratoriyadagi toʻlqin uzunligi) / laboratoriyadagi toʻlqin
uzunligi.**

Agar z = 1 boʻlsa, har bir toʻlqin ikki baravar uzaygan boʻladi.

Yaqin obyektlarda kichik qizil yoki koʻk siljish bizga tomon yoki bizdan uzoqlashuvchi harakatdan
kelib chiqadi (Doppler effekti). Uzoq galaktikalarda esa asosiy sabab boshqa: nur yoʻlda boʻlgan
paytda fazoning oʻzi kengaygan va yorugʻlik toʻlqinlari ham u bilan birga choʻzilgan. Shuning uchun
1 + z nur yoʻlga chiqqanidan beri koinot necha marta kattalashganini bildiradi: z = 1 da koinot
hozirgidan ikki baravar kichik boʻlgan.

## Buni qayerdan bilamiz?

1929-yilda Edvin Habbl yaqin galaktikalargacha masofalarni ularning spektridan oʻlchangan tezliklari
bilan solishtirdi va galaktika qanchalik uzoq boʻlsa, shunchalik tez uzoqlashayotgandek koʻrinishini
aniqladi. Bu bogʻliqlik koinot kengayayotganining asosiy dalillaridan biriga aylandi.

Bugun qizil siljish spektrdan oʻlchanadi. [DESI](doc:desi-survey) asbobi bir vaqtda 5 000 ta spektr
oladi va millionlab galaktika hamda [kvazar](doc:quasar)larning qizil siljishini oʻlchagan. z va
kengayayotgan koinot modeli (bu atlas Planck 2018 parametrlaridan foydalanadi) masofani beradi. Shu
modeldan bir nechta misol:

| Qizil siljish z | Bugungi masofa (birga harakatlanuvchi) | Nur yoʻlga chiqqan vaqt |
|---|---|---|
| 0,01 | 44 Mpk | 0,14 milliard yil oldin |
| 0,1 | 433 Mpk | 1,3 milliard yil oldin |
| 0,5 | 1,95 Gpk | 5,2 milliard yil oldin |
| 1 | 3,40 Gpk | 7,9 milliard yil oldin |
| 2 | 5,31 Gpk | 10,5 milliard yil oldin |

## Ajoyib, lekin rost

- 3C 273 kvazarining sirini 1963-yilda Marten Shmidt ochdi: u spektrdagi chiziqlar z = 0,158 ga surilgan
  oddiy vodorod chiziqlari ekanini tushundi. Bunday qizil siljish obyekt juda uzoq va gʻoyat yorqin
  ekanini bildirardi.
- Qizil siljish faqat tezlik emas. z = 1 dagi galaktika nuri koinot kattalashgani uchun choʻzilgan.
- Galaktikalar qoʻshnilari tortishi taʼsirida fazoda oʻzicha ham harakatlanadi. Yaqin galaktikalar
  uchun bu qizil siljish boʻyicha topilgan masofaga sezilarli xato qoʻshadi, shuning uchun atlas
  z = 0,003 dan kichik qiymatlarda boshqa usullardan foydalanadi
  ([masofa noaniqligi](doc:distance-uncertainty)).

## Atlasda qayerda?

[DESI](#layer=galaxies-desi) yoki [2MRS](#layer=galaxies-2mrs) qatlamlaridagi istalgan nuqtani bosing:
kartada uning qizil siljishi z, birga harakatlanuvchi masofasi va
[oʻtmishga qarash vaqti](doc:lookback-time) chiqadi. Atlasda galaktikalar rangi ham qizil siljishga
bogʻliq: z = 0 yaqinida iliq fil suyagi rangi, keyin pushti, z ≈ 1,5 dan boshlab binafsha; kvazarlar
och zangori rangda chiziladi. Atlasdagi 15,1 million DESI obyektining toʻrtdan uch qismida z birdan
kichik, z ≥ 4 boʻlganlari bor-yoʻgʻi 6 100 ga yaqin, eng uzoq kvazarlar esa z ≈ 6,8 ga yetadi. 10 Mpk dan
uzoqroqqa chiqqaningizda, masshtab shkalasi ostidagi koʻrsatkich koʻrinish markazidagi qizil siljishni
ham yozadi.
