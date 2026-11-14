/** Colour HiPS surveys for galaxy thumbnails (the fetch / reprojection code is in hipsCutout.ts). */

export interface HipsSurvey {
  id: string;
  title: string;
  credit: string;
  /** tile mirrors with CORS, in order of preference */
  mirrors: string[];
  maxOrder: number;
  tileFormat: 'jpg' | 'png';
}

export const DSS2_COLOR: HipsSurvey = {
  id: 'CDS/P/DSS2/color',
  title: 'DSS2 colour',
  credit: 'Digitized Sky Survey (STScI/NASA; POSS-II, UK Schmidt), coloured and HiPS by CDS (CDS/P/DSS2/color)',
  mirrors: ['https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color', 'https://skies.esac.esa.int/DSSColor'],
  maxOrder: 9,
  tileFormat: 'jpg',
};
