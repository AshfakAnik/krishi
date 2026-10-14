import { Crop, CropVariety, Land, Party, Season } from '../../models/agriculture';
import { SEASON_ANCHOR, addDays } from '../../models/common';

/**
 * Every date here is derived from `SEASON_ANCHOR` so the app renders the same
 * numbers on every reload. Vocabulary — season names, land types, varieties,
 * village names — comes from the activity diagram and the domain it describes,
 * not from placeholder text.
 */

export const SEASONS: Season[] = [
  {
    id: 'season-aus-2025',
    name: 'Aus 2025',
    year: 2025,
    startsOn: addDays(SEASON_ANCHOR, -75),
    endsOn: addDays(SEASON_ANCHOR, -5),
    active: false,
  },
  {
    id: 'season-aman-2025',
    name: 'Aman 2025',
    year: 2025,
    startsOn: SEASON_ANCHOR,
    endsOn: addDays(SEASON_ANCHOR, 165),
    active: true,
  },
  {
    id: 'season-boro-2026',
    name: 'Boro 2025–26',
    year: 2026,
    startsOn: addDays(SEASON_ANCHOR, 170),
    endsOn: addDays(SEASON_ANCHOR, 320),
    active: true,
  },
];

export const CROPS: Crop[] = [
  { id: 'crop-paddy', name: 'Paddy (Dhan)', suitableLandTypes: ['dhani'] },
  { id: 'crop-jute', name: 'Jute (Pat)', suitableLandTypes: ['dhani'] },
  { id: 'crop-potato', name: 'Potato (Alu)', suitableLandTypes: ['vita'] },
  { id: 'crop-mustard', name: 'Mustard (Sarisha)', suitableLandTypes: ['vita', 'dhani'] },
  { id: 'crop-vegetable', name: 'Vegetables (Shak-sobji)', suitableLandTypes: ['vita'] },
];

export const CROP_VARIETIES: CropVariety[] = [
  {
    id: 'var-br11',
    cropId: 'crop-paddy',
    name: 'BR-11 (Mukta)',
    durationDays: 145,
    expectedYieldPerDecimal: 0.62,
  },
  {
    id: 'var-bri49',
    cropId: 'crop-paddy',
    name: 'BRRI dhan49',
    durationDays: 135,
    expectedYieldPerDecimal: 0.58,
  },
  {
    id: 'var-bini7',
    cropId: 'crop-paddy',
    name: 'Binadhan-7',
    durationDays: 120,
    expectedYieldPerDecimal: 0.55,
  },
  {
    id: 'var-tossa',
    cropId: 'crop-jute',
    name: 'Tossa (O-9897)',
    durationDays: 120,
    expectedYieldPerDecimal: 0.35,
  },
  {
    id: 'var-diamant',
    cropId: 'crop-potato',
    name: 'Diamant',
    durationDays: 90,
    expectedYieldPerDecimal: 1.8,
  },
  {
    id: 'var-bari14',
    cropId: 'crop-mustard',
    name: 'BARI Sarisha-14',
    durationDays: 80,
    expectedYieldPerDecimal: 0.22,
  },
  {
    id: 'var-mixed-veg',
    cropId: 'crop-vegetable',
    name: 'Mixed winter vegetables',
    durationDays: 75,
    expectedYieldPerDecimal: 1.1,
  },
];

export const PARTIES: Party[] = [
  {
    id: 'party-owner-1',
    name: 'Ashfakul Alam',
    role: 'owner',
    phone: '01711-204588',
    village: 'Shibpur',
    status: 'active',
  },
  {
    id: 'party-owner-2',
    name: 'Nurul Haque Mridha',
    role: 'owner',
    phone: '01712-660141',
    village: 'Char Boalia',
    status: 'active',
  },
  {
    id: 'party-admin-1',
    name: 'Rezaul Karim',
    role: 'admin',
    phone: '01819-330277',
    village: 'Shibpur',
    status: 'active',
  },
  {
    id: 'party-sc-1',
    name: 'Abdul Malek',
    role: 'sharecropper',
    phone: '01914-556210',
    village: 'Shibpur',
    seasonsWorked: 6,
    status: 'active',
  },
  {
    id: 'party-sc-2',
    name: 'Jashim Uddin',
    role: 'sharecropper',
    phone: '01733-190845',
    village: 'Char Boalia',
    seasonsWorked: 3,
    status: 'active',
  },
  {
    id: 'party-sc-3',
    name: 'Monir Hossain',
    role: 'sharecropper',
    phone: '01925-471309',
    village: 'Kalikapur',
    seasonsWorked: 1,
    status: 'active',
  },
  {
    id: 'party-sc-4',
    name: 'Shahjahan Sheikh',
    role: 'sharecropper',
    phone: '01677-802914',
    village: 'Shibpur',
    seasonsWorked: 9,
    status: 'active',
  },
];

/**
 * `heldByAgreementId` is the cross-entity link the reference module writes:
 * activating an agreement claims the plot, revoking it releases the plot. Two
 * plots start held (by the two active seed agreements), the rest are free — so
 * the "land already committed" rule is demonstrable without inventing data.
 */
export const LANDS: Land[] = [
  {
    id: 'land-1',
    code: 'SHB-DAG-104',
    name: 'Boro Dhani Beel',
    landType: 'dhani',
    area: 132,
    location: 'Shibpur, Mouza Shibpur, Dag 104',
    ownerId: 'party-owner-1',
    heldByAgreementId: 'agr-1',
  },
  {
    id: 'land-2',
    code: 'SHB-DAG-118',
    name: 'Uttar Para Dhani',
    landType: 'dhani',
    area: 96,
    location: 'Shibpur, Mouza Shibpur, Dag 118',
    ownerId: 'party-owner-1',
    heldByAgreementId: null,
  },
  {
    id: 'land-3',
    code: 'SHB-DAG-121',
    name: 'Bari Vita',
    landType: 'vita',
    area: 44,
    location: 'Shibpur, Mouza Shibpur, Dag 121',
    ownerId: 'party-owner-1',
    heldByAgreementId: null,
  },
  {
    id: 'land-4',
    code: 'CHB-DAG-057',
    name: 'Char Boalia Dhani',
    landType: 'dhani',
    area: 210,
    location: 'Char Boalia, Mouza Boalia, Dag 57',
    ownerId: 'party-owner-2',
    heldByAgreementId: 'agr-2',
  },
  {
    id: 'land-5',
    code: 'CHB-DAG-063',
    name: 'Purba Vita',
    landType: 'vita',
    area: 61,
    location: 'Char Boalia, Mouza Boalia, Dag 63',
    ownerId: 'party-owner-2',
    heldByAgreementId: null,
  },
  {
    id: 'land-6',
    code: 'KLP-DAG-012',
    name: 'Kalikapur Dhani',
    landType: 'dhani',
    area: 74,
    location: 'Kalikapur, Mouza Kalikapur, Dag 12',
    ownerId: 'party-owner-2',
    heldByAgreementId: null,
  },
];
