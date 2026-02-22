import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

// ─── SUPABASE CLIENT ────────────────────────────────────────────────────────
const supabase = createClient(
  'https://hhzqvwxsfohawerhmhcn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoenF2d3hzZm9oYXdlcmhtaGNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MTk4ODgsImV4cCI6MjA4NzE5NTg4OH0.NX5fc3JcB4OcbW4LcJsQIQhgrb-T9FGJhJ0VGgn-QCs'
)

// ─── CSV PARSER ────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { properties: [], errors: ['CSV must have a header row and at least one data row.'] }

  // Parse header
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))

  // Map common header variations to our field names
  const headerMap = {
    name: 'name', propertyname: 'name', property: 'name', facilityname: 'name',
    address: 'address', streetaddress: 'address', street: 'address', location: 'address',
    city: 'city', town: 'city',
    state: 'state', st: 'state',
    zip: 'zip', zipcode: 'zip', postalcode: 'zip',
    purchaseprice: 'purchasePrice', price: 'purchasePrice', askingprice: 'purchasePrice', listprice: 'purchasePrice',
    unitcount: 'unitCount', units: 'unitCount', numberofunits: 'unitCount', totalunits: 'unitCount',
    totalsf: 'totalSF', sqft: 'totalSF', squarefeet: 'totalSF', totalsquarefeet: 'totalSF', sf: 'totalSF',
    occupancyrate: 'occupancyRate', occupancy: 'occupancyRate', occ: 'occupancyRate',
    avgrentperunit: 'avgRentPerUnit', avgrent: 'avgRentPerUnit', averagerent: 'avgRentPerUnit', rent: 'avgRentPerUnit', rentperunit: 'avgRentPerUnit',
    operatingexpenses: 'operatingExpenses', opex: 'operatingExpenses', expenses: 'operatingExpenses',
    propertytax: 'propertyTax', tax: 'propertyTax', taxes: 'propertyTax',
    insurance: 'insurance', ins: 'insurance',
    yearbuilt: 'yearBuilt', year: 'yearBuilt',
    notes: 'notes', comments: 'notes', description: 'notes',
  }

  const mappedHeaders = headers.map(h => headerMap[h] || null)
  const properties = []
  const errors = []

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const values = parseCSVLine(lines[i])
    const raw = {}
    mappedHeaders.forEach((field, idx) => {
      if (field && idx < values.length) raw[field] = values[idx].trim()
    })

    // Validate required fields
    if (!raw.name && !raw.address) {
      errors.push(`Row ${i + 1}: Missing property name and address — skipped.`)
      continue
    }

    // Parse numeric fields
    const occ = parseFloat(raw.occupancyRate || '0')
    const prop = {
      id: Date.now() + i,
      name: raw.name || raw.address || 'Unnamed',
      address: raw.address || '',
      city: raw.city || '',
      state: raw.state || loadSettings().defaultState,
      zip: raw.zip || '',
      purchasePrice: parseNum(raw.purchasePrice),
      unitCount: parseNum(raw.unitCount),
      totalSF: parseNum(raw.totalSF),
      occupancyRate: occ > 1 ? occ / 100 : occ, // Handle both 85 and 0.85
      avgRentPerUnit: parseNum(raw.avgRentPerUnit),
      operatingExpenses: parseNum(raw.operatingExpenses),
      propertyTax: parseNum(raw.propertyTax),
      insurance: parseNum(raw.insurance),
      yearBuilt: parseNum(raw.yearBuilt) || 2000,
      notes: raw.notes || '',
      imported: true, // flag to distinguish from sample data
    }

    if (!prop.purchasePrice) {
      errors.push(`Row ${i + 1} (${prop.name}): Missing purchase price — skipped.`)
      continue
    }
    if (!prop.unitCount) {
      errors.push(`Row ${i + 1} (${prop.name}): Missing unit count — skipped.`)
      continue
    }

    properties.push(prop)
  }

  return { properties, errors }
}

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else current += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { result.push(current); current = '' }
      else current += ch
    }
  }
  result.push(current)
  return result
}

function parseNum(str) {
  if (!str) return 0
  return parseFloat(str.replace(/[$,\s%]/g, '')) || 0
}

function generateCSVTemplate() {
  const headers = 'name,address,city,state,zip,purchasePrice,unitCount,totalSF,occupancyRate,avgRentPerUnit,operatingExpenses,propertyTax,insurance,yearBuilt,notes'
  const example = '"Example Storage","123 Main St","Columbus","OH","43215",750000,150,25000,0.85,70,35000,14000,8000,2005,"Great location"'
  return headers + '\n' + example
}

// ─── HAVERSINE DISTANCE ────────────────────────────────────────────────────
// ─── SETTINGS (persisted to Supabase + localStorage cache) ──────────────────
const SETTINGS_ROW_NAME = '__storagevault_settings__'

const DEFAULT_SETTINGS = {
  homeCity: 'Columbus',
  homeState: 'OH',
  homeZip: '43215',
  homeLat: 39.9612,
  homeLng: -82.9988,
  defaultState: 'OH',
  // Underwriting thresholds
  minCapRate: 7,
  maxExpenseRatio: 40,
  minDSCR: 1.25,
  minOccupancy: 70,
  // Financing scenarios
  sellerRate: 6.0,
  sellerDown: 10,
  sellerYears: 15,
  sbaRate: 6.75,
  sbaDown: 15,
  sbaYears: 25,
  conventionalRate: 6.3,
  conventionalDown: 25,
  conventionalYears: 25,
  cashEarnest: 5,
}

// Load from localStorage cache (synchronous, used during render)
function loadSettings() {
  try {
    const saved = localStorage.getItem('storagevault_settings')
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }
  } catch {}
  return { ...DEFAULT_SETTINGS }
}

// Save to both localStorage and Supabase
async function saveSettingsToDb(settings) {
  try { localStorage.setItem('storagevault_settings', JSON.stringify(settings)) } catch {}
  try {
    const json = JSON.stringify(settings)
    // Check if settings row exists
    const { data } = await supabase.from('properties').select('id').eq('name', SETTINGS_ROW_NAME).limit(1)
    if (data && data.length > 0) {
      await supabase.from('properties').update({ notes: json, updated_at: new Date().toISOString() }).eq('id', data[0].id)
    } else {
      await supabase.from('properties').insert({ name: SETTINGS_ROW_NAME, notes: json, address: '', city: '', state: '', zip: '' })
    }
  } catch (e) {
    console.error('Failed to save settings to Supabase:', e)
  }
}

// Load settings from Supabase (async, called on mount)
async function loadSettingsFromDb() {
  try {
    const { data } = await supabase.from('properties').select('notes').eq('name', SETTINGS_ROW_NAME).limit(1)
    if (data && data.length > 0 && data[0].notes) {
      const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data[0].notes) }
      try { localStorage.setItem('storagevault_settings', JSON.stringify(settings)) } catch {}
      return settings
    }
  } catch (e) {
    console.error('Failed to load settings from Supabase:', e)
  }
  return null
}

// ─── AREA STORAGE RATES (avg $/unit/month for 10x10, 2025 industry data) ────
// Sources: StorageCafe, SpareFoot, RentCafe, SROA — Dec 2025
// City-level rates where available, state averages as fallback
const STORAGE_RATES = {
  // City-level rates (city lowercase → avg 10x10 $/mo)
  cities: {
    // Ohio
    'columbus,oh': 92, 'cincinnati,oh': 94, 'cleveland,oh': 88, 'dayton,oh': 84,
    'akron,oh': 80, 'toledo,oh': 78, 'youngstown,oh': 75,
    // Indiana
    'indianapolis,in': 85, 'fort wayne,in': 75, 'evansville,in': 72, 'south bend,in': 78,
    // Kentucky
    'louisville,ky': 93, 'lexington,ky': 88, 'bowling green,ky': 78,
    // West Virginia
    'charleston,wv': 80, 'morgantown,wv': 82, 'huntington,wv': 75,
    // Pennsylvania
    'philadelphia,pa': 139, 'pittsburgh,pa': 120, 'allentown,pa': 95, 'harrisburg,pa': 92,
    // Major metros
    'new york,ny': 260, 'los angeles,ca': 269, 'san francisco,ca': 292,
    'san diego,ca': 180, 'sacramento,ca': 140, 'san jose,ca': 220,
    'chicago,il': 115, 'houston,tx': 95, 'dallas,tx': 107, 'austin,tx': 100,
    'san antonio,tx': 97, 'fort worth,tx': 100, 'phoenix,az': 115,
    'seattle,wa': 192, 'portland,or': 145, 'denver,co': 120, 'miami,fl': 165,
    'tampa,fl': 110, 'orlando,fl': 108, 'jacksonville,fl': 95,
    'atlanta,ga': 105, 'charlotte,nc': 98, 'raleigh,nc': 100,
    'nashville,tn': 105, 'memphis,tn': 75, 'knoxville,tn': 82,
    'detroit,mi': 110, 'grand rapids,mi': 90, 'minneapolis,mn': 115,
    'st louis,mo': 89, 'kansas city,mo': 88, 'oklahoma city,ok': 68,
    'las vegas,nv': 113, 'salt lake city,ut': 105, 'boise,id': 95,
    'boston,ma': 222, 'washington,dc': 175, 'baltimore,md': 125,
    'richmond,va': 100, 'virginia beach,va': 105,
    'columbia,sc': 99, 'charleston,sc': 110,
    'birmingham,al': 70, 'montgomery,al': 50,
    'new orleans,la': 85, 'baton rouge,la': 80,
    'milwaukee,wi': 80, 'madison,wi': 90,
    'des moines,ia': 75, 'omaha,ne': 78,
    'little rock,ar': 72, 'jackson,ms': 65,
    'honolulu,hi': 297, 'anchorage,ak': 130,
    'albuquerque,nm': 85, 'tucson,az': 95,
  },
  // State-level averages (fallback)
  states: {
    'OH': 88, 'IN': 80, 'KY': 85, 'WV': 78, 'PA': 110,
    'NY': 180, 'NJ': 150, 'CT': 145, 'MA': 160, 'RI': 135,
    'NH': 110, 'VT': 100, 'ME': 95,
    'CA': 195, 'WA': 150, 'OR': 125, 'HI': 220, 'AK': 120,
    'TX': 95, 'FL': 110, 'GA': 95, 'NC': 95, 'SC': 95,
    'VA': 100, 'MD': 120, 'DC': 175, 'DE': 110,
    'TN': 85, 'AL': 68, 'MS': 62, 'LA': 80, 'AR': 70,
    'IL': 100, 'MI': 95, 'MN': 100, 'WI': 82, 'IA': 72,
    'MO': 85, 'OK': 65, 'KS': 75, 'NE': 75, 'SD': 70, 'ND': 72,
    'CO': 115, 'AZ': 105, 'NV': 110, 'UT': 100, 'NM': 82,
    'ID': 88, 'MT': 80, 'WY': 75,
  },
  national: 119, // National average 10x10 (Dec 2025)
}

// Get estimated area rate for a city/state combo
function getAreaRate(city, state) {
  if (city && state) {
    const key = `${city.trim().toLowerCase()},${state.trim().toLowerCase()}`
    if (STORAGE_RATES.cities[key]) return { rate: STORAGE_RATES.cities[key], source: `${city}, ${state} avg` }
  }
  if (state) {
    const st = state.trim().toUpperCase()
    if (STORAGE_RATES.states[st]) return { rate: STORAGE_RATES.states[st], source: `${st} state avg` }
  }
  return { rate: STORAGE_RATES.national, source: 'National avg' }
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function geocodeAndDistance(address, city, state, zip, homeLat, homeLng) {
  const settings = loadSettings()
  const refLat = homeLat ?? settings.homeLat
  const refLng = homeLng ?? settings.homeLng
  const query = `${address}, ${city}, ${state} ${zip}`.trim().replace(/,\s*,/g, ',')
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=1`, {
      headers: { 'User-Agent': 'StorageVault/1.0' }
    })
    const data = await resp.json()
    if (data.length > 0) {
      const lat = parseFloat(data[0].lat)
      const lng = parseFloat(data[0].lon)
      return Math.round(haversineDistance(refLat, refLng, lat, lng))
    }
  } catch (e) { /* ignore geocoding errors */ }
  return null
}


// ─── UTILITY FUNCTIONS ──────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmtFull = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const pct = (n) => (n * 100).toFixed(2) + '%'

function calcMonthlyPayment(principal, annualRate, years) {
  if (annualRate === 0 || years === 0) return 0
  const r = annualRate / 12
  const n = years * 12
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

function getDistance(p) {
  return p.calculatedDistance ?? 999
}

function runUnderwriting(prop, mgmtFeePct = 0.06, capExPct = 0.05) {
  const s = loadSettings()
  const gpi = prop.unitCount * prop.avgRentPerUnit * 12
  const egi = gpi * prop.occupancyRate
  const mgmtFee = egi * mgmtFeePct
  const capEx = egi * capExPct
  const totalOpEx = prop.operatingExpenses + prop.propertyTax + prop.insurance + mgmtFee + capEx
  const noi = egi - totalOpEx
  const capRate = noi / prop.purchasePrice
  const expenseRatio = totalOpEx / egi
  const pricePerUnit = prop.purchasePrice / prop.unitCount
  const pricePerSF = prop.purchasePrice / (prop.totalSF || 1)

  const fixedOpEx = prop.operatingExpenses + prop.propertyTax + prop.insurance
  const variablePct = mgmtFeePct + capExPct
  const breakEvenOcc = gpi > 0 ? fixedOpEx / (gpi * (1 - variablePct)) : 0

  const revenuePerSF = prop.totalSF > 0 ? egi / prop.totalSF : 0

  const scenarios = [
    { name: "Seller Financed", downPct: s.sellerDown / 100, rate: s.sellerRate / 100, years: s.sellerYears, earnestPct: 0.01 },
    { name: "SBA 7(a)", downPct: s.sbaDown / 100, rate: s.sbaRate / 100, years: s.sbaYears, earnestPct: 0.01 },
    { name: "Conventional", downPct: s.conventionalDown / 100, rate: s.conventionalRate / 100, years: s.conventionalYears, earnestPct: 0.02 },
    { name: "Cash Offer", downPct: 1.0, rate: 0, years: 0, earnestPct: s.cashEarnest / 100 },
  ].map(sc => {
    const downPayment = prop.purchasePrice * sc.downPct
    const loanAmount = prop.purchasePrice - downPayment
    const monthlyPayment = calcMonthlyPayment(loanAmount, sc.rate, sc.years)
    const annualDebt = monthlyPayment * 12
    const cashFlow = noi - annualDebt
    const dscr = annualDebt > 0 ? noi / annualDebt : Infinity
    const cashOnCash = downPayment > 0 ? cashFlow / downPayment : 0
    const closingCosts = prop.purchasePrice * 0.03
    const totalCashNeeded = downPayment + closingCosts
    const earnestMoney = prop.purchasePrice * sc.earnestPct
    return { ...sc, downPayment, loanAmount, monthlyPayment, annualDebt, cashFlow, dscr, cashOnCash, closingCosts, totalCashNeeded, earnestMoney }
  })

  const reasons = []
  if (capRate < s.minCapRate / 100) reasons.push(`Cap rate below ${s.minCapRate}%`)
  if (expenseRatio > s.maxExpenseRatio / 100) reasons.push(`Expense ratio above ${s.maxExpenseRatio}%`)
  if (scenarios[0].dscr < s.minDSCR && scenarios[0].dscr !== Infinity) reasons.push(`DSCR below ${s.minDSCR} (seller financed)`)
  if (scenarios[2].dscr < s.minDSCR && scenarios[2].dscr !== Infinity) reasons.push(`DSCR below ${s.minDSCR} (conventional)`)
  if (prop.occupancyRate < s.minOccupancy / 100) reasons.push(`Occupancy below ${s.minOccupancy}%`)
  const autoVerdict = reasons.length === 0 ? 'PASS' : 'FAIL'
  const verdict = prop.verdictOverride || 'PENDING'

  return { gpi, egi, mgmtFee, capEx, totalOpEx, noi, capRate, expenseRatio, pricePerUnit, pricePerSF, breakEvenOcc, revenuePerSF, scenarios, verdict, autoVerdict, reasons }
}

// ─── OFFER LETTER GENERATOR ─────────────────────────────────────────────────
function generateOfferLetter(prop, scenario, buyerName, buyerAddress, sellerName) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const offerPrice = scenario.name === "Cash Offer" ? Math.round(prop.purchasePrice * 0.875) : prop.purchasePrice
  const closingDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  let financingTerms = ''
  if (scenario.name === "Seller Financed") {
    financingTerms = `This offer is contingent upon Seller providing financing under the following terms:
  - Down Payment: ${fmt(scenario.downPayment)} (${pct(scenario.downPct)} of purchase price)
  - Interest Rate: ${pct(scenario.rate)} per annum, fixed
  - Amortization: ${scenario.years} years, fully amortizing
  - Monthly Payment: ${fmtFull(scenario.monthlyPayment)}
  - No prepayment penalty after Year 3`
  } else if (scenario.name === "SBA 7(a)") {
    financingTerms = `This offer is contingent upon Buyer obtaining SBA 7(a) financing under the following terms:
  - Down Payment: ${fmt(scenario.downPayment)} (${pct(scenario.downPct)} of purchase price)
  - Loan Amount: ${fmt(scenario.loanAmount)}
  - Estimated Interest Rate: ${pct(scenario.rate)} per annum (variable, tied to Prime)
  - Loan Term: ${scenario.years} years
  - Financing Contingency Period: 60 days from mutual acceptance
  - Subject to SBA approval and standard SBA eligibility requirements`
  } else if (scenario.name === "Conventional") {
    financingTerms = `This offer is contingent upon Buyer obtaining conventional financing under the following terms:
  - Down Payment: ${fmt(scenario.downPayment)} (${pct(scenario.downPct)} of purchase price)
  - Loan Amount: ${fmt(scenario.loanAmount)}
  - Estimated Interest Rate: ${pct(scenario.rate)} per annum
  - Loan Term: ${scenario.years} years
  - Financing Contingency Period: 45 days from mutual acceptance`
  } else {
    financingTerms = `This is an ALL-CASH offer with no financing contingency.
  - Offer Price: ${fmt(offerPrice)} (${pct(0.125)} discount for cash closing)
  - Proof of funds to be provided within 5 business days of acceptance`
  }

  return `
═══════════════════════════════════════════════════════════
           LETTER OF INTENT TO PURCHASE
              SELF-STORAGE FACILITY
═══════════════════════════════════════════════════════════

Date: ${today}

To: ${sellerName || "[Seller Name]"}
Re: Purchase of ${prop.name}
    ${prop.address}, ${prop.city}, ${prop.state} ${prop.zip}

Dear ${sellerName || "[Seller Name]"},

${buyerName || "[Buyer Name]"} ("Buyer") hereby submits this Letter of Intent
to purchase the above-referenced self-storage facility ("Property") under the
terms and conditions outlined below.

───────────────────────────────────────────────────────────
1. PURCHASE PRICE
───────────────────────────────────────────────────────────

  Purchase Price: ${fmt(offerPrice)}

───────────────────────────────────────────────────────────
2. EARNEST MONEY DEPOSIT
───────────────────────────────────────────────────────────

  Earnest Money: ${fmt(scenario.earnestMoney)}
  To be deposited into escrow within 3 business days of
  mutual acceptance of this Letter of Intent.

───────────────────────────────────────────────────────────
3. FINANCING TERMS
───────────────────────────────────────────────────────────

${financingTerms}

───────────────────────────────────────────────────────────
4. DUE DILIGENCE PERIOD
───────────────────────────────────────────────────────────

  Buyer shall have a period of thirty (30) days from mutual
  acceptance to conduct due diligence, including but not
  limited to:

  a) Physical inspection of all buildings and units
  b) Review of financial records (minimum 3 years)
  c) Environmental Phase I assessment
  d) Title search and survey review
  e) Zoning and permit verification
  f) Review of existing leases and tenant records
  g) Insurance loss history review

  During this period, Buyer may terminate this agreement
  for any reason and receive a full refund of earnest money.

───────────────────────────────────────────────────────────
5. CLOSING
───────────────────────────────────────────────────────────

  Target Closing Date: ${closingDate}
  Closing shall take place at a mutually agreed-upon
  title company.

  Seller shall provide at closing:
  - Warranty deed
  - Bill of sale for all personal property
  - Assignment of existing tenant agreements
  - Current rent roll and financial statements
  - All keys, codes, and access credentials
  - Non-compete agreement (5 years, 10-mile radius)

───────────────────────────────────────────────────────────
6. REPRESENTATIONS & WARRANTIES
───────────────────────────────────────────────────────────

  Seller represents and warrants that:
  a) Seller has authority to sell the Property
  b) No pending litigation affecting the Property
  c) All financial statements are accurate and complete
  d) No undisclosed environmental conditions
  e) All systems and structures are in working order
  f) Property taxes are current

───────────────────────────────────────────────────────────
7. CONFIDENTIALITY
───────────────────────────────────────────────────────────

  Both parties agree to keep the terms of this Letter
  of Intent confidential until closing.

───────────────────────────────────────────────────────────

This Letter of Intent is non-binding except for the
confidentiality provision above. A binding Purchase and
Sale Agreement will be executed within 10 business days
of acceptance of this LOI.

This offer shall remain open for acceptance until
${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.


Respectfully submitted,


_________________________________
${buyerName || "[Buyer Name]"}
${buyerAddress || "[Buyer Address]"}


ACCEPTED AND AGREED:


_________________________________
${sellerName || "[Seller Name]"}
Date: ___________________________


═══════════════════════════════════════════════════════════
`.trim()
}

// ─── COMPONENTS ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color = "text-navy-900" }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-4">
      <p className="text-xs font-medium text-navy-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-navy-400 mt-1">{sub}</p>}
    </div>
  )
}

function Badge({ text, variant }) {
  const colors = {
    pass: "bg-emerald-100 text-emerald-700 border-emerald-200",
    fail: "bg-red-100 text-red-700 border-red-200",
    pending: "bg-amber-100 text-amber-700 border-amber-200",
    info: "bg-blue-100 text-blue-700 border-blue-200",
    imported: "bg-purple-100 text-purple-700 border-purple-200",
  }
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colors[variant] || colors.info}`}>{text}</span>
}

// ─── IMPORT CSV MODAL ───────────────────────────────────────────────────────
function ImportCSVModal({ onImport, onClose }) {
  const [mode, setMode] = useState('file') // 'file' or 'paste'
  const [csvText, setCsvText] = useState('')
  const [errors, setErrors] = useState([])
  const [preview, setPreview] = useState(null)
  const fileInputRef = useRef(null)

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      setCsvText(text)
      const result = parseCSV(text)
      setPreview(result)
      setErrors(result.errors)
    }
    reader.readAsText(file)
  }

  const handlePastePreview = () => {
    if (!csvText.trim()) return
    const result = parseCSV(csvText)
    setPreview(result)
    setErrors(result.errors)
  }

  const handleImport = () => {
    if (!preview || preview.properties.length === 0) return
    onImport(preview.properties)
    onClose()
  }

  const handleDownloadTemplate = () => {
    const blob = new Blob([generateCSVTemplate()], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'storagevault_import_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-navy-900">Import Properties from CSV</h3>
          <button onClick={onClose} className="text-navy-400 hover:text-navy-600 text-xl">&times;</button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setMode('file')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${mode === 'file' ? 'bg-navy-800 text-white' : 'bg-navy-100 text-navy-600 hover:bg-navy-200'}`}>
            Upload CSV File
          </button>
          <button onClick={() => setMode('paste')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${mode === 'paste' ? 'bg-navy-800 text-white' : 'bg-navy-100 text-navy-600 hover:bg-navy-200'}`}>
            Paste CSV Text
          </button>
          <button onClick={handleDownloadTemplate} className="ml-auto text-sm text-blue-600 hover:text-blue-800 font-medium">
            Download Template
          </button>
        </div>

        {mode === 'file' ? (
          <div>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-navy-200 rounded-xl p-8 text-center cursor-pointer hover:border-navy-400 hover:bg-navy-50/50 transition"
            >
              <div className="text-3xl mb-2">📁</div>
              <p className="text-navy-600 font-medium">Click to select a CSV file</p>
              <p className="text-navy-400 text-sm mt-1">or drag and drop</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFileChange} />
          </div>
        ) : (
          <div>
            <textarea
              className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none h-40"
              placeholder={`Paste your CSV here...\n\nExample:\nname,address,city,state,zip,purchasePrice,unitCount,totalSF,occupancyRate,avgRentPerUnit,operatingExpenses,propertyTax,insurance\n"My Storage","123 Main St","Columbus","OH","43215",750000,150,25000,0.85,70,35000,14000,8000`}
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
            />
            <button onClick={handlePastePreview} className="mt-2 bg-navy-100 text-navy-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-navy-200 transition">
              Preview Import
            </button>
          </div>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm font-semibold text-amber-700 mb-1">Warnings ({errors.length})</p>
            <ul className="text-xs text-amber-600 space-y-0.5">
              {errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
              {errors.length > 10 && <li>...and {errors.length - 10} more</li>}
            </ul>
          </div>
        )}

        {/* Preview */}
        {preview && preview.properties.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-emerald-700 mb-2">Ready to import {preview.properties.length} properties:</p>
            <div className="overflow-x-auto max-h-48 border border-navy-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-navy-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-navy-600">Name</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-navy-600">Address</th>
                    <th className="px-2 py-1.5 text-left font-semibold text-navy-600">City</th>
                    <th className="px-2 py-1.5 text-right font-semibold text-navy-600">Price</th>
                    <th className="px-2 py-1.5 text-right font-semibold text-navy-600">Units</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {preview.properties.map((p, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5">{p.name}</td>
                      <td className="px-2 py-1.5 text-navy-500">{p.address}</td>
                      <td className="px-2 py-1.5">{p.city}, {p.state}</td>
                      <td className="px-2 py-1.5 text-right">{fmt(p.purchasePrice)}</td>
                      <td className="px-2 py-1.5 text-right">{p.unitCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 mt-5">
          <button
            onClick={handleImport}
            disabled={!preview || preview.properties.length === 0}
            className={`flex-1 py-2.5 rounded-lg font-medium transition ${preview && preview.properties.length > 0 ? 'bg-navy-800 text-white hover:bg-navy-900' : 'bg-navy-200 text-navy-400 cursor-not-allowed'}`}
          >
            Import {preview ? preview.properties.length : 0} Properties
          </button>
          <button onClick={onClose} className="flex-1 border border-navy-200 text-navy-700 py-2.5 rounded-lg font-medium hover:bg-navy-50 transition">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── SCRAPE FROM URL COMPONENT ────────────────────────────────────────────
function ScrapeURLModal({ onImport, onClose }) {
  const [mode, setMode] = useState('paste') // 'url' or 'paste'
  const [url, setUrl] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [scraped, setScraped] = useState(null)
  const [editData, setEditData] = useState(null)

  const CORS_PROXIES = [
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ]

  // Detect if response is a Cloudflare/bot challenge page instead of real content
  function isBlockedPage(html) {
    return /just a moment|checking your browser|cloudflare|enable javascript.*cookies/i.test(html.substring(0, 2000))
  }

  // Detect the listing site from URL
  function detectSite(u) {
    if (/crexi\.com/i.test(u)) return 'crexi'
    if (/loopnet\.com/i.test(u)) return 'loopnet'
    if (/commercialcafe/i.test(u)) return 'commercialcafe'
    if (/showcase\.com/i.test(u)) return 'showcase'
    if (/storable|sparefoot|selfstorage\.com/i.test(u)) return 'selfstorage'
    return 'generic'
  }

  // Extract number from text (handles "$1,200,000", "1200000", etc.)
  function extractNum(text) {
    if (!text) return 0
    const m = text.replace(/[$,%]/g, '').replace(/,/g, '').match(/-?[\d.]+/)
    return m ? parseFloat(m[0]) : 0
  }

  // Generic meta/JSON-LD extraction
  function extractFromHTML(html, site) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const data = { name: '', address: '', city: '', state: loadSettings().defaultState, zip: '', purchasePrice: 0, unitCount: 0, totalSF: 0, occupancyRate: 0.85, avgRentPerUnit: 0, operatingExpenses: 0, propertyTax: 0, insurance: 0, listingUrl: '', notes: '' }

    // Try JSON-LD structured data first
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]')
    for (const script of jsonLdScripts) {
      try {
        const ld = JSON.parse(script.textContent)
        const items = Array.isArray(ld) ? ld : [ld]
        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type'] === 'RealEstateListing' || item['@type'] === 'Place') {
            data.name = data.name || item.name || ''
            if (item.address) {
              if (typeof item.address === 'string') { data.address = item.address }
              else {
                data.address = data.address || item.address.streetAddress || ''
                data.city = data.city || item.address.addressLocality || ''
                data.state = item.address.addressRegion || data.state
                data.zip = data.zip || item.address.postalCode || ''
              }
            }
            if (item.offers?.price) data.purchasePrice = extractNum(String(item.offers.price))
          }
        }
      } catch (e) { /* ignore JSON parse errors */ }
    }

    // Open Graph & meta tags
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.content || ''
    const ogDesc = doc.querySelector('meta[property="og:description"]')?.content || ''
    const metaDesc = doc.querySelector('meta[name="description"]')?.content || ''
    const pageTitle = doc.querySelector('title')?.textContent || ''
    data.name = data.name || ogTitle || pageTitle

    // Combine all text for pattern matching
    const allText = `${ogTitle} ${ogDesc} ${metaDesc} ${doc.body?.textContent || ''}`

    // ── Site-specific extraction ──
    if (site === 'crexi') {
      // Crexi puts data in specific elements
      const priceEl = doc.querySelector('[class*="price"], [data-testid*="price"], .listing-price')
      if (priceEl) data.purchasePrice = extractNum(priceEl.textContent)
      const addrEl = doc.querySelector('[class*="address"], [data-testid*="address"], .listing-address')
      if (addrEl) data.address = addrEl.textContent.trim()
      // Look for units in property highlights
      const highlights = doc.querySelectorAll('[class*="highlight"], [class*="detail"], [class*="fact"], li')
      for (const el of highlights) {
        const t = el.textContent.toLowerCase()
        if (/unit/i.test(t)) data.unitCount = data.unitCount || extractNum(t)
        if (/sq\s*ft|square\s*feet|sf\b/i.test(t)) data.totalSF = data.totalSF || extractNum(t)
        if (/occupan/i.test(t)) { const v = extractNum(t); data.occupancyRate = v > 1 ? v / 100 : v }
        if (/cap\s*rate/i.test(t)) { /* informational only */ }
      }
    }

    if (site === 'loopnet') {
      const priceEl = doc.querySelector('.price-display, [class*="price"], [class*="Price"]')
      if (priceEl) data.purchasePrice = extractNum(priceEl.textContent)
      const addrEl = doc.querySelector('.listing-address, [class*="address"], h1')
      if (addrEl) data.address = addrEl.textContent.trim()
      const facts = doc.querySelectorAll('.property-data td, .property-facts li, [class*="fact"], [class*="detail"]')
      for (const el of facts) {
        const t = el.textContent.toLowerCase()
        if (/unit/i.test(t) && !data.unitCount) data.unitCount = extractNum(t)
        if (/sq\s*ft|sf\b|square/i.test(t) && !data.totalSF) data.totalSF = extractNum(t)
        if (/occupan/i.test(t)) { const v = extractNum(t); data.occupancyRate = v > 1 ? v / 100 : (v || data.occupancyRate) }
      }
    }

    // ── Generic regex patterns for any site ──
    if (!data.purchasePrice) {
      const priceMatch = allText.match(/(?:price|asking|listed?\s*(?:at|for)?)[:\s]*\$?([\d,]+(?:\.\d+)?)/i)
        || allText.match(/\$([\d,]{6,})/i)
      if (priceMatch) data.purchasePrice = extractNum(priceMatch[1])
    }
    if (!data.unitCount) {
      const unitMatch = allText.match(/([\d,]+)\s*(?:units?|spaces?|doors?)/i)
      if (unitMatch) data.unitCount = extractNum(unitMatch[1])
    }
    if (!data.totalSF) {
      const sfMatch = allText.match(/([\d,]+)\s*(?:sq\.?\s*ft|square\s*feet|sf\b)/i)
      if (sfMatch) data.totalSF = extractNum(sfMatch[1])
    }
    if (!data.address) {
      // Try to find address pattern: "123 Main St"
      const addrMatch = allText.match(/(\d{1,6}\s+[A-Z][a-zA-Z\s]{2,30}(?:St|Ave|Rd|Dr|Ln|Blvd|Way|Ct|Pl|Hwy|Pike|Route)\b[^,]*)/i)
      if (addrMatch) data.address = addrMatch[1].trim()
    }
    if (!data.city || !data.zip) {
      // Try "City, ST 12345" pattern
      const locMatch = allText.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s*([A-Z]{2})\s+(\d{5})/m)
      if (locMatch) {
        data.city = data.city || locMatch[1]
        data.state = locMatch[2]
        data.zip = data.zip || locMatch[3]
      }
    }

    // Occupancy from text
    if (data.occupancyRate === 0.85) {
      const occMatch = allText.match(/occupan\w*[:\s]*([\d.]+)\s*%/i)
      if (occMatch) { const v = parseFloat(occMatch[1]); data.occupancyRate = v > 1 ? v / 100 : v }
    }

    data.listingUrl = url
    data.notes = `Scraped from: ${url}`
    return data
  }

  // Extract property data from pasted plain text
  function extractFromText(text) {
    const data = { name: '', address: '', city: '', state: loadSettings().defaultState, zip: '', purchasePrice: 0, unitCount: 0, totalSF: 0, occupancyRate: 0.85, avgRentPerUnit: 0, operatingExpenses: 0, propertyTax: 0, insurance: 0, listingUrl: '', notes: '' }

    // Price patterns: "$1,200,000", "Price: $850,000", "Asking $750K", "1.2M"
    const priceMatch = text.match(/(?:price|asking|listed?\s*(?:at|for)?)[:\s]*\$?([\d,]+(?:\.\d+)?(?:\s*[MmKk])?)/i)
      || text.match(/\$([\d,]+(?:\.\d+)?(?:\s*[MmKk])?)/i)
    if (priceMatch) {
      let p = priceMatch[1].replace(/,/g, '')
      if (/[Mm]/.test(p)) p = parseFloat(p) * 1000000
      else if (/[Kk]/.test(p)) p = parseFloat(p) * 1000
      data.purchasePrice = parseFloat(p) || 0
    }

    // Units: "140 units", "280 doors", "150 spaces"
    const unitMatch = text.match(/([\d,]+)\s*(?:units?|doors?|spaces?)/i)
    if (unitMatch) data.unitCount = extractNum(unitMatch[1])

    // Square footage
    const sfMatch = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|square\s*feet|sf\b|rentable sf|net sf)/i)
    if (sfMatch) data.totalSF = extractNum(sfMatch[1])

    // Occupancy: "85% occupied", "occupancy: 92%", "occupancy rate of 88%"
    const occMatch = text.match(/(?:occupan\w*|occupied)[:\s]*([\d.]+)\s*%/i)
      || text.match(/([\d.]+)\s*%\s*occupi?e?d/i)
    if (occMatch) { const v = parseFloat(occMatch[1]); data.occupancyRate = v > 1 ? v / 100 : v }

    // Cap rate
    const capMatch = text.match(/cap\s*rate[:\s]*([\d.]+)\s*%/i)
    if (capMatch) data.notes += `Cap rate: ${capMatch[1]}%\n`

    // Address: "123 Main St"
    const addrMatch = text.match(/(\d{1,6}\s+[A-Z][a-zA-Z\s]{2,30}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Way|Ct|Court|Pl|Place|Hwy|Highway|Pike|Route)\b[^,\n]*)/i)
    if (addrMatch) data.address = addrMatch[1].trim()

    // City, State Zip: "Columbus, OH 43215"
    const locMatch = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s*([A-Z]{2})\s+(\d{5})/m)
    if (locMatch) {
      data.city = locMatch[1]
      data.state = locMatch[2]
      data.zip = locMatch[3]
    }

    // Property name: try first line or anything before the address
    const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length > 0 && lines[0].length < 80 && !/^\d/.test(lines[0]) && !/price|unit|sq\s*ft|occupan/i.test(lines[0])) {
      data.name = lines[0]
    }

    // NOI: "NOI: $65,000", "Net Operating Income $52,000"
    const noiMatch = text.match(/(?:NOI|net\s*operating\s*income)[:\s]*\$?([\d,]+)/i)
    if (noiMatch) data.notes += `NOI: $${noiMatch[1]}\n`

    // Rent: "$150/unit", "avg rent $125"
    const rentMatch = text.match(/(?:rent|avg\.?\s*rent|average\s*rent)[:\s]*\$?([\d,]+(?:\.\d+)?)/i)
      || text.match(/\$?([\d,]+(?:\.\d+)?)\s*(?:\/\s*unit|per\s*unit|\/\s*month|\/\s*mo)/i)
    if (rentMatch) data.avgRentPerUnit = extractNum(rentMatch[1])

    data.notes = (data.notes + 'Extracted from pasted text').trim()
    return data
  }

  const handlePastedExtract = () => {
    if (!pastedText.trim()) return
    setError(null)
    setScraped(null)
    setEditData(null)

    try {
      const data = extractFromText(pastedText)
      if (!data.name && !data.address && !data.purchasePrice && !data.unitCount) {
        setError('Could not auto-detect property details. The fields below are blank — you can fill them in manually.')
      }
      setScraped(data)
      setEditData({ ...data })
    } catch (e) {
      setError('Error parsing text: ' + e.message)
    }
  }

  const handleScrape = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    setScraped(null)
    setEditData(null)

    let html = null
    const site = detectSite(url)

    // Try each CORS proxy
    let blocked = false
    for (const proxyFn of CORS_PROXIES) {
      try {
        const resp = await fetch(proxyFn(url.trim()), { headers: { 'Accept': 'text/html' } })
        if (resp.ok) {
          const text = await resp.text()
          if (text && text.length > 500 && !isBlockedPage(text)) {
            html = text
            break
          }
          if (isBlockedPage(text)) blocked = true
        }
      } catch (e) { /* try next proxy */ }
    }

    if (!html || html.length < 500) {
      setError(blocked
        ? 'This site uses bot protection (Cloudflare) that blocks automated scraping. Try using "Add Property" to enter details manually, or "Import CSV" to paste data from a spreadsheet.'
        : 'Could not fetch the listing page. The site may block automated access. Try using "Add Property" or "Import CSV" instead.'
      )
      setLoading(false)
      return
    }

    try {
      const data = extractFromHTML(html, site)
      if (!data.name && !data.address && !data.purchasePrice) {
        setError('Could not extract property details from this page. You can edit the fields below manually, or use "Import CSV" or "Add Property" instead.')
      }
      setScraped(data)
      setEditData({ ...data })
    } catch (e) {
      setError('Error parsing the listing page: ' + e.message)
    }

    setLoading(false)
  }

  const handleImport = () => {
    if (!editData) return
    const prop = {
      ...editData,
      purchasePrice: parseFloat(editData.purchasePrice) || 0,
      unitCount: parseInt(editData.unitCount) || 0,
      totalSF: parseInt(editData.totalSF) || 0,
      occupancyRate: parseFloat(editData.occupancyRate) || 0.85,
      avgRentPerUnit: parseFloat(editData.avgRentPerUnit) || 0,
      operatingExpenses: parseFloat(editData.operatingExpenses) || 0,
      propertyTax: parseFloat(editData.propertyTax) || 0,
      insurance: parseFloat(editData.insurance) || 0,
      listingUrl: editData.listingUrl || '',
      id: Date.now(),
      imported: true,
      source: 'scrape',
    }
    onImport([prop])
    onClose()
  }

  const fieldDefs = [
    ['name', 'Property Name', 'text'], ['address', 'Street Address', 'text'],
    ['city', 'City', 'text'], ['state', 'State', 'text'], ['zip', 'Zip', 'text'],
    ['purchasePrice', 'Purchase Price ($)', 'number'], ['unitCount', 'Units', 'number'],
    ['totalSF', 'Total Sq Ft', 'number'], ['occupancyRate', 'Occupancy (0-1)', 'number'],
    ['avgRentPerUnit', 'Avg Rent/Unit ($/mo)', 'number'],
    ['operatingExpenses', 'Operating Expenses ($/yr)', 'number'],
    ['propertyTax', 'Property Tax ($/yr)', 'number'], ['insurance', 'Insurance ($/yr)', 'number'],
    ['listingUrl', 'Listing URL', 'url'],
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-navy-900">Import from Listing</h3>
          <button onClick={onClose} className="text-navy-400 hover:text-navy-600 text-xl">✕</button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-4 bg-navy-50 rounded-lg p-1">
          <button onClick={() => { setMode('paste'); setError(null) }} className={`flex-1 text-sm py-2 rounded-md font-medium transition ${mode === 'paste' ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}>
            Paste Listing Text
          </button>
          <button onClick={() => { setMode('url'); setError(null) }} className={`flex-1 text-sm py-2 rounded-md font-medium transition ${mode === 'url' ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}>
            Scrape from URL
          </button>
        </div>

        {mode === 'paste' ? (
          <div className="mb-4">
            <p className="text-sm text-navy-500 mb-3">Copy the listing details from any website and paste them below. We'll extract the property info automatically.</p>
            <textarea
              className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
              rows={6}
              placeholder={"Example:\nOak Creek Self Storage\n1234 Oak Creek Rd, Columbus, OH 43215\n$850,000 · 120 units · 45,000 SF\n92% occupied · Cap Rate: 7.5%"}
              value={pastedText}
              onChange={e => setPastedText(e.target.value)}
            />
            <button
              onClick={handlePastedExtract}
              disabled={!pastedText.trim()}
              className="mt-2 bg-orange-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-orange-700 transition disabled:opacity-50 flex items-center gap-2"
            >
              <span>📋</span> Extract Details
            </button>
          </div>
        ) : (
          <div className="mb-4">
            <p className="text-sm text-navy-500 mb-3">Paste a listing URL. Note: many sites (Crexi, LoopNet) use bot protection that may block this. If it fails, use "Paste Listing Text" instead.</p>
            <div className="flex gap-2">
              <input
                type="url"
                className="flex-1 border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="https://www.loopnet.com/listing/..."
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScrape()}
              />
              <button
                onClick={handleScrape}
                disabled={loading || !url.trim()}
                className="bg-orange-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-orange-700 transition disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
              >
                {loading ? (
                  <><span className="animate-spin inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full"></span> Scraping...</>
                ) : (
                  <><span>🌐</span> Scrape</>
                )}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-700">{error}</div>
        )}

        {/* Editable results */}
        {editData && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h4 className="font-medium text-navy-800">Extracted Data</h4>
              <span className="text-xs text-navy-400">(edit any field before importing)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {fieldDefs.map(([key, label, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-navy-600 mb-1">{label}</label>
                  <input
                    type={type}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none ${editData[key] && String(editData[key]) !== '0' && String(editData[key]) !== '0.85' ? 'border-emerald-300 bg-emerald-50' : 'border-navy-200'}`}
                    value={editData[key]}
                    onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium text-navy-600 mb-1">Notes</label>
              <textarea
                className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                rows={2}
                value={editData.notes}
                onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))}
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mt-5">
          {editData ? (
            <button
              onClick={handleImport}
              className="flex-1 py-2.5 rounded-lg font-medium transition bg-orange-600 text-white hover:bg-orange-700"
            >
              Import Property
            </button>
          ) : (
            <p className="flex-1 py-2.5 text-center text-sm text-navy-400">
              Paste a URL above and click Scrape to extract property data
            </p>
          )}
          <button onClick={onClose} className="flex-1 border border-navy-200 text-navy-700 py-2.5 rounded-lg font-medium hover:bg-navy-50 transition">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── BUY BOX TAB ────────────────────────────────────────────────────────────
function BuyBoxTab({ properties, setProperties, onSelectProperty }) {
  const [criteria, setCriteria] = useState({
    maxPrice: '', maxDistance: '', minUnits: '', minCapRate: '', minOccupancy: ''
  })
  const [showAddForm, setShowAddForm] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showScrapeModal, setShowScrapeModal] = useState(false)
  const [newProp, setNewProp] = useState({ name: '', address: '', city: '', state: loadSettings().defaultState, zip: '', purchasePrice: '', unitCount: '', totalSF: '', occupancyRate: '', avgRentPerUnit: '', operatingExpenses: '', propertyTax: '', insurance: '', notes: '' })
  const [addFormError, setAddFormError] = useState(null)
  const [sortKey, setSortKey] = useState('purchasePrice')
  const [sortDir, setSortDir] = useState('asc')
  const [geocodingStatus, setGeocodingStatus] = useState(null)

  // Check if any filter is actively set (non-empty)
  const hasActiveFilters = Object.values(criteria).some(v => v !== '' && v !== null && v !== undefined)

  const sortFn = (a, b) => {
    let av = a[sortKey], bv = b[sortKey]
    if (sortKey === 'capRate') {
      av = runUnderwriting(a).capRate
      bv = runUnderwriting(b).capRate
    }
    if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase() }
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
  }

  const matchesFilter = (p) => {
    const dist = getDistance(p)
    const distKnown = dist < 999
    const uw = runUnderwriting(p)
    const hasIncome = p.avgRentPerUnit > 0
    const maxPrice = criteria.maxPrice !== '' ? +criteria.maxPrice : Infinity
    const maxDist = criteria.maxDistance !== '' ? +criteria.maxDistance : Infinity
    const minUnits = criteria.minUnits !== '' ? +criteria.minUnits : 0
    const minCap = criteria.minCapRate !== '' ? +criteria.minCapRate / 100 : -Infinity
    const minOcc = criteria.minOccupancy !== '' ? +criteria.minOccupancy / 100 : 0
    return p.purchasePrice <= maxPrice
      && (!distKnown || dist <= maxDist)
      && p.unitCount >= minUnits
      && (!hasIncome || uw.capRate >= minCap)
      && p.occupancyRate >= minOcc
  }

  const { matched, unmatched } = useMemo(() => {
    const m = [], u = []
    for (const p of properties) {
      if (matchesFilter(p)) m.push(p)
      else u.push(p)
    }
    return { matched: m.sort(sortFn), unmatched: u.sort(sortFn) }
  }, [properties, criteria, sortKey, sortDir])

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const handleAddProperty = () => {
    // Validate required fields
    const missing = []
    if (!newProp.name.trim()) missing.push('Property Name')
    if (!newProp.city.trim()) missing.push('City')
    if (!newProp.purchasePrice || +newProp.purchasePrice <= 0) missing.push('Purchase Price')
    if (!newProp.unitCount || +newProp.unitCount <= 0) missing.push('Unit Count')
    if (missing.length > 0) {
      setAddFormError(`Please fill in: ${missing.join(', ')}`)
      return
    }
    const p = {
      id: Date.now(), name: newProp.name.trim(), address: newProp.address.trim() || newProp.city.trim(), city: newProp.city.trim(), state: newProp.state || loadSettings().defaultState, zip: newProp.zip,
      purchasePrice: +newProp.purchasePrice, unitCount: +newProp.unitCount, totalSF: +newProp.totalSF || 0,
      occupancyRate: newProp.occupancyRate ? +newProp.occupancyRate / 100 : 0.85, avgRentPerUnit: +newProp.avgRentPerUnit || 0,
      operatingExpenses: +newProp.operatingExpenses || 0, propertyTax: +newProp.propertyTax || 0, insurance: +newProp.insurance || 0,
      yearBuilt: 2000, notes: newProp.notes, imported: true
    }
    setAddFormError(null)
    setProperties(prev => [...prev, p])
    setShowAddForm(false)
    setNewProp({ name: '', address: '', city: '', state: loadSettings().defaultState, zip: '', purchasePrice: '', unitCount: '', totalSF: '', occupancyRate: '', avgRentPerUnit: '', operatingExpenses: '', propertyTax: '', insurance: '', notes: '' })
  }

  const handleImport = async (imported) => {
    // Geocode distances for properties without known zips
    const needsGeocode = imported.filter(p => !p.calculatedDistance)
    if (needsGeocode.length > 0) {
      setGeocodingStatus(`Calculating distances for ${needsGeocode.length} properties...`)
      for (let i = 0; i < needsGeocode.length; i++) {
        const p = needsGeocode[i]
        const dist = await geocodeAndDistance(p.address, p.city, p.state, p.zip)
        if (dist !== null) p.calculatedDistance = dist
        // Rate limit: 1 req/sec for Nominatim
        if (i < needsGeocode.length - 1) await new Promise(r => setTimeout(r, 1100))
        setGeocodingStatus(`Calculating distances... ${i + 1}/${needsGeocode.length}`)
      }
      setGeocodingStatus(null)
    }
    setProperties(prev => [...prev, ...imported])
  }

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="text-navy-300 ml-1">↕</span>
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div>
      {/* Geocoding status bar */}
      {geocodingStatus && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center gap-2">
          <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></span>
          <span className="text-sm text-blue-700">{geocodingStatus}</span>
        </div>
      )}

      {/* Criteria */}
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-6 mb-6">
        <h3 className="text-lg font-semibold text-navy-900 mb-4">Define Your Buy Box</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            ['maxPrice', 'Max Price', null],
            ['maxDistance', 'Max Distance (mi)', null],
            ['minUnits', 'Min Units', null],
            ['minCapRate', 'Min Cap Rate (%)', '0.5'],
            ['minOccupancy', 'Min Occupancy (%)', '1'],
          ].map(([key, label, step]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-navy-600 mb-1">{label}</label>
              <input type="number" step={step || undefined} placeholder="N/A" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder:text-navy-300" value={criteria[key]} onChange={e => setCriteria(c => ({ ...c, [key]: e.target.value === '' ? '' : e.target.value }))} />
            </div>
          ))}
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-100 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-navy-900">{hasActiveFilters ? `${matched.length} of ${properties.length} Match` : `${properties.length} Properties`}</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setShowScrapeModal(true)} className="bg-orange-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-orange-700 transition flex items-center gap-1"><span>🌐</span> Scrape URL</button>
            <button onClick={() => setShowImportModal(true)} className="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-emerald-700 transition">Import CSV</button>
            <button onClick={() => setShowAddForm(true)} className="bg-navy-800 text-white text-sm px-4 py-2 rounded-lg hover:bg-navy-900 transition">+ Add Property</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-navy-50">
              <tr>
                {[
                  ['name', 'Property'], ['address', 'Address'], ['city', 'City'], ['purchasePrice', 'Price'],
                  ['unitCount', 'Units'], ['occupancyRate', 'Occupancy'], ['capRate', 'Est. Cap Rate'], ['', 'Verdict'], ['', '']
                ].map(([key, label], i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-navy-600 uppercase tracking-wide cursor-pointer select-none" onClick={() => key && handleSort(key)}>
                    {label}{key && <SortIcon col={key} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {matched.map(p => {
                const uw = runUnderwriting(p)
                return (
                  <tr key={p.id} className="hover:bg-navy-50 transition">
                    <td className="px-4 py-3 font-medium text-navy-900">
                      <div className="flex items-center gap-1.5">
                        {p.name}

                      </div>
                    </td>
                    <td className="px-4 py-3 text-navy-500 text-xs max-w-[200px] truncate" title={p.address}>{p.address}</td>
                    <td className="px-4 py-3 text-navy-600">{p.city}, {p.state}</td>
                    <td className="px-4 py-3 font-medium">{fmt(p.purchasePrice)}</td>
                    <td className="px-4 py-3">{p.unitCount}</td>
                    <td className="px-4 py-3">{pct(p.occupancyRate)}</td>
                    <td className="px-4 py-3 font-medium">{pct(uw.capRate)}</td>
                    <td className="px-4 py-3"><Badge text={uw.verdict} variant={uw.verdict === 'PASS' ? 'pass' : uw.verdict === 'FAIL' ? 'fail' : 'pending'} /></td>
                    <td className="px-4 py-3">
                      <button onClick={() => onSelectProperty(p)} className="text-blue-600 hover:text-blue-800 text-xs font-semibold">Underwrite →</button>
                    </td>
                  </tr>
                )
              })}
              {hasActiveFilters && matched.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-navy-400">No properties match your Buy Box criteria.</td></tr>
              )}
              {hasActiveFilters && unmatched.length > 0 && (
                <tr className="bg-navy-50/50">
                  <td colSpan={9} className="px-4 py-2 text-xs font-semibold text-navy-400 uppercase tracking-wide">
                    Outside Buy Box ({unmatched.length})
                  </td>
                </tr>
              )}
              {hasActiveFilters && unmatched.map(p => {
                const uw = runUnderwriting(p)
                return (
                  <tr key={p.id} className="hover:bg-navy-50 transition opacity-50">
                    <td className="px-4 py-3 font-medium text-navy-900">
                      <div className="flex items-center gap-1.5">
                        {p.name}

                      </div>
                    </td>
                    <td className="px-4 py-3 text-navy-500 text-xs max-w-[200px] truncate" title={p.address}>{p.address}</td>
                    <td className="px-4 py-3 text-navy-600">{p.city}, {p.state}</td>
                    <td className="px-4 py-3 font-medium">{fmt(p.purchasePrice)}</td>
                    <td className="px-4 py-3">{p.unitCount}</td>
                    <td className="px-4 py-3">{pct(p.occupancyRate)}</td>
                    <td className="px-4 py-3 font-medium">{pct(uw.capRate)}</td>
                    <td className="px-4 py-3"><Badge text={uw.verdict} variant={uw.verdict === 'PASS' ? 'pass' : uw.verdict === 'FAIL' ? 'fail' : 'pending'} /></td>
                    <td className="px-4 py-3">
                      <button onClick={() => onSelectProperty(p)} className="text-blue-600 hover:text-blue-800 text-xs font-semibold">Underwrite →</button>
                    </td>
                  </tr>
                )
              })}
              {properties.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-navy-400">No properties yet. Add one above to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Property Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-navy-900 mb-4">Add New Property</h3>
            {addFormError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{addFormError}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {[
                ['name', 'Property Name *', 'text'], ['address', 'Street Address', 'text'], ['city', 'City *', 'text'], ['zip', 'Zip Code', 'text'], ['purchasePrice', 'Purchase Price ($) *', 'number'],
                ['unitCount', 'Unit Count *', 'number'], ['totalSF', 'Total Sq Ft', 'number'], ['occupancyRate', 'Occupancy (%)', 'number'], ['avgRentPerUnit', 'Avg Rent/Unit ($/mo)', 'number'],
                ['operatingExpenses', 'Operating Expenses ($/yr)', 'number'], ['propertyTax', 'Property Tax ($/yr)', 'number'], ['insurance', 'Insurance ($/yr)', 'number'],
              ].map(([key, label, type]) => {
                const isRequired = ['name', 'city', 'purchasePrice', 'unitCount'].includes(key)
                const hasError = addFormError && isRequired && (!newProp[key] || (type === 'number' && +newProp[key] <= 0))
                const est = key === 'avgRentPerUnit' ? getAreaRate(newProp.city, newProp.state || loadSettings().defaultState) : null
                return (
                  <div key={key}>
                    <label className="block text-xs font-medium text-navy-600 mb-1">{label}</label>
                    <div className={key === 'avgRentPerUnit' ? 'flex gap-1' : ''}>
                      <input type={type} className={`${key === 'avgRentPerUnit' ? 'flex-1' : 'w-full'} border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none ${hasError ? 'border-red-400 bg-red-50' : 'border-navy-200'}`} value={newProp[key]} onChange={e => { setNewProp(p => ({ ...p, [key]: e.target.value })); if (addFormError) setAddFormError(null) }} placeholder={type === 'number' && isRequired ? 'Required' : est ? `~$${est.rate}` : ''} />
                      {est && (
                        <button type="button" onClick={() => setNewProp(p => ({ ...p, avgRentPerUnit: est.rate }))} title={`Use ${est.source}: $${est.rate}/mo`} className="px-2 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition whitespace-nowrap">
                          ~${est.rate}
                        </button>
                      )}
                    </div>
                    {est && <p className="text-xs text-navy-400 mt-0.5">{est.source} (2025 data)</p>}
                  </div>
                )
              })}
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium text-navy-600 mb-1">Notes</label>
              <textarea className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" rows={2} value={newProp.notes} onChange={e => setNewProp(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleAddProperty} className="flex-1 bg-navy-800 text-white py-2 rounded-lg font-medium hover:bg-navy-900 transition">Add Property</button>
              <button onClick={() => { setShowAddForm(false); setAddFormError(null) }} className="flex-1 border border-navy-200 text-navy-700 py-2 rounded-lg font-medium hover:bg-navy-50 transition">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Import CSV Modal */}
      {showImportModal && <ImportCSVModal onImport={handleImport} onClose={() => setShowImportModal(false)} />}

      {/* Scrape URL Modal */}
      {showScrapeModal && <ScrapeURLModal onImport={handleImport} onClose={() => setShowScrapeModal(false)} />}
    </div>
  )
}

// ─── UNDERWRITING TAB ───────────────────────────────────────────────────────
// ─── POPULATION / MARKET DEMAND DATA (10-mile radius) ───────────────────────
const STATE_FIPS = {AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56'}

const MILES_10_IN_METERS = 16093

// Geocode city/state → lat/lng using multiple geocoders with fallback
// Cache to avoid duplicate requests (especially when MarketDemand + Competitors both request same address)
const geocodeCache = {}

async function geocodeLocation(address, city, state) {
  const query = address && address.toLowerCase() !== city.toLowerCase()
    ? `${address}, ${city}, ${state}`
    : `${city}, ${state}`
  const cacheKey = query.toLowerCase()

  // Return cached result or pending promise
  if (geocodeCache[cacheKey]) return geocodeCache[cacheKey]

  const promise = (async () => {
    // Try Photon (Komoot) first — free, no auth, CORS-friendly, OSM-based
    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=en`
      )
      if (res.ok) {
        const data = await res.json()
        if (data.features && data.features[0]) {
          const [lng, lat] = data.features[0].geometry.coordinates
          return { lat, lng }
        }
      }
    } catch { /* fall through to Nominatim */ }

    // Fallback: Nominatim with email identification (their recommended practice)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=us&format=json&limit=1&email=storagevault-app@users.noreply.github.com`
      )
      if (res.ok) {
        const data = await res.json()
        if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
      }
    } catch { /* both failed */ }

    return null
  })()

  geocodeCache[cacheKey] = promise
  return promise
}

// Find all Census places within 10 miles using TIGERweb ArcGIS spatial query
async function findNearbyPlaces(lat, lng) {
  const query = (layer) =>
    fetch(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer/${layer}/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&distance=${MILES_10_IN_METERS}&units=esriSRUnit_Meter&outFields=NAME,STATE,PLACE&returnGeometry=false&f=json`)
      .then(r => r.json())
      .then(d => (d.features || []).map(f => f.attributes))
      .catch(() => [])

  // Layer 24 = Incorporated Places, Layer 26 = Census Designated Places
  const [incPlaces, cdpPlaces] = await Promise.all([query(24), query(26)])
  // Deduplicate by PLACE fips
  const seen = new Set()
  return [...incPlaces, ...cdpPlaces].filter(p => {
    if (seen.has(p.PLACE)) return false
    seen.add(p.PLACE)
    return true
  })
}

// Fetch aggregated population for nearby places across multiple ACS years
const acsYearCache = {} // cache: `${year}-${stateFip}` → [{placeFip, pop, name}]

async function fetchRadiusPopulation(nearbyPlaces) {
  if (nearbyPlaces.length === 0) return null
  const stateFip = nearbyPlaces[0].STATE
  const placeFips = new Set(nearbyPlaces.map(p => p.PLACE))
  const years = [2022, 2021, 2020, 2019, 2018, 2017, 2016]
  const yearlyTotals = []

  await Promise.all(years.map(async (year) => {
    try {
      const cacheKey = `${year}-${stateFip}`
      if (!acsYearCache[cacheKey]) {
        const res = await fetch(
          `https://api.census.gov/data/${year}/acs/acs5?get=B01001_001E,NAME&for=place:*&in=state:${stateFip}`
        )
        const data = await res.json()
        acsYearCache[cacheKey] = data.slice(1).map(row => ({
          placeFip: row[3], pop: parseInt(row[0]) || 0, name: row[1]
        }))
      }
      let total = 0
      let count = 0
      acsYearCache[cacheKey].forEach(row => {
        if (placeFips.has(row.placeFip)) { total += row.pop; count++ }
      })
      if (total > 0) yearlyTotals.push({ year, population: total, placeCount: count })
    } catch { /* skip */ }
  }))

  if (yearlyTotals.length < 2) return null
  yearlyTotals.sort((a, b) => b.year - a.year)
  return yearlyTotals
}

async function fetchPopulationData(address, city, state) {
  if (!city || !state) return null
  try {
    // Step 1: Geocode the property location
    const coords = await geocodeLocation(address, city, state)
    if (!coords) return null

    // Step 2: Find all Census places within 10 miles
    const nearbyPlaces = await findNearbyPlaces(coords.lat, coords.lng)
    if (nearbyPlaces.length === 0) return null

    // Step 3: Get aggregated population across years
    const yearlyData = await fetchRadiusPopulation(nearbyPlaces)
    if (!yearlyData) return null

    // Step 4: Calculate growth metrics
    const latest = yearlyData[0]
    const earliest = yearlyData[yearlyData.length - 1]
    const yearSpan = latest.year - earliest.year
    const totalGrowth = yearSpan > 0 ? (latest.population - earliest.population) / earliest.population : 0
    const annualGrowth = yearSpan > 0 ? Math.pow(1 + totalGrowth, 1 / yearSpan) - 1 : 0
    const prev = yearlyData[1]
    const oneYearChange = prev ? (latest.population - prev.population) / prev.population : 0

    return {
      placeName: `${city}, ${state}`,
      placeNames: nearbyPlaces.map(p => p.NAME.replace(/ city$| village$| CDP$| town$/, '')),
      placeCount: nearbyPlaces.length,
      latestYear: latest.year,
      latestPop: latest.population,
      prevPop: earliest.population,
      prevYear: earliest.year,
      annualGrowth,
      totalGrowth,
      oneYearChange,
      dataPoints: yearlyData.map(d => ({ year: d.year, population: d.population })),
    }
  } catch (e) {
    console.error('Population lookup failed:', e)
    return null
  }
}

function MarketDemandSection({ address, city, state, onPopulationLoaded }) {
  const [popData, setPopData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showPlaces, setShowPlaces] = useState(false)
  const lastLookup = useRef('')

  useEffect(() => {
    const key = `${address}|${city}|${state}`
    if (key === lastLookup.current) return
    if (!city) { setPopData(null); return }
    lastLookup.current = key
    setLoading(true)
    setError(null)
    setShowPlaces(false)
    fetchPopulationData(address, city, state)
      .then(data => {
        if (data) { setPopData(data); setError(null); if (onPopulationLoaded) onPopulationLoaded(data.latestPop) }
        else { setError('No population data found for this location.'); if (onPopulationLoaded) onPopulationLoaded(null) }
      })
      .catch(() => setError('Failed to fetch population data.'))
      .finally(() => setLoading(false))
  }, [address, city, state])

  const getTrend = (annualGrowth) => {
    if (annualGrowth > 0.005) return { label: 'Growing', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: '📈', desc: 'Population is increasing — strong demand signal' }
    if (annualGrowth < -0.005) return { label: 'Shrinking', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: '📉', desc: 'Population is declining — potential demand risk' }
    return { label: 'Stable', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: '➡️', desc: 'Population is relatively flat' }
  }

  const renderMiniChart = (dataPoints) => {
    if (!dataPoints || dataPoints.length < 2) return null
    const pops = dataPoints.map(d => d.population)
    const minPop = Math.min(...pops)
    const maxPop = Math.max(...pops)
    const range = maxPop - minPop || 1
    const reversed = [...dataPoints].reverse()
    return (
      <div className="mt-3">
        <div className="flex items-end gap-1 h-16">
          {reversed.map((d, i) => {
            const height = 12 + ((d.population - minPop) / range) * 48
            const isLatest = i === reversed.length - 1
            return (
              <div key={d.year} className="flex flex-col items-center flex-1">
                <div
                  className={`w-full rounded-t ${isLatest ? 'bg-blue-500' : 'bg-navy-300'} transition-all`}
                  style={{ height: `${height}px` }}
                  title={`${d.year}: ${d.population.toLocaleString()}`}
                />
              </div>
            )
          })}
        </div>
        <div className="flex gap-1 mt-1">
          {reversed.map((d) => (
            <div key={d.year} className="flex-1 text-center text-[9px] text-navy-400">{d.year.toString().slice(2)}</div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-navy-700 uppercase tracking-wide">Market Demand</h4>
        <span className="text-xs text-navy-400 bg-navy-50 px-2 py-1 rounded">10-mile radius</span>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-navy-500 text-sm">
          <div className="animate-spin w-4 h-4 border-2 border-navy-300 border-t-blue-500 rounded-full" />
          Analyzing population within 10 miles of {city}, {state}...
        </div>
      )}
      {error && !loading && (
        <p className="text-sm text-navy-400">{error}</p>
      )}
      {popData && !loading && (() => {
        const trend = getTrend(popData.annualGrowth)
        return (
          <div>
            <div className="flex items-start gap-4 flex-wrap">
              {/* Trend badge */}
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${trend.bg}`}>
                <span className="text-2xl">{trend.icon}</span>
                <div>
                  <div className={`font-bold ${trend.color}`}>{trend.label}</div>
                  <div className="text-xs text-navy-500">{trend.desc}</div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 flex-1 min-w-[300px]">
                <div>
                  <div className="text-xs text-navy-500">Area Population ({popData.latestYear})</div>
                  <div className="text-lg font-bold text-navy-900">{popData.latestPop.toLocaleString()}</div>
                  <div className="text-[10px] text-navy-400">{popData.placeCount} communities</div>
                </div>
                <div>
                  <div className="text-xs text-navy-500">Avg Annual Growth</div>
                  <div className={`text-lg font-bold ${popData.annualGrowth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {popData.annualGrowth >= 0 ? '+' : ''}{(popData.annualGrowth * 100).toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-navy-400">{popData.prevYear}–{popData.latestYear}</div>
                </div>
                <div>
                  <div className="text-xs text-navy-500">1-Year Change</div>
                  <div className={`text-lg font-bold ${popData.oneYearChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {popData.oneYearChange >= 0 ? '+' : ''}{(popData.oneYearChange * 100).toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Mini chart */}
            <div className="mt-3 pt-3 border-t border-navy-100">
              <div className="text-xs text-navy-500 mb-1">Population Trend — 10-mile radius of {popData.placeName}</div>
              {renderMiniChart(popData.dataPoints)}
            </div>

            {/* Nearby communities list */}
            {popData.placeNames && popData.placeNames.length > 0 && (
              <div className="mt-3 pt-3 border-t border-navy-100">
                <button
                  onClick={() => setShowPlaces(!showPlaces)}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  {showPlaces ? '▾' : '▸'} {popData.placeCount} communities included in area
                </button>
                {showPlaces && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {popData.placeNames.map((name, i) => (
                      <span key={i} className="text-xs bg-navy-50 text-navy-600 px-2 py-0.5 rounded">{name}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─── COMPETITORS (Self-Storage via OpenStreetMap Overpass API) ───────────────
const MILES_5_IN_METERS = 8047

// Haversine distance in miles
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Calculate polygon area from lat/lon coords using Shoelace formula → sq meters
function polygonAreaSqM(coords) {
  if (!coords || coords.length < 3) return 0
  let area = 0
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length
    const lat1 = coords[i].lat * Math.PI / 180
    const lat2 = coords[j].lat * Math.PI / 180
    const lon1 = coords[i].lon * Math.PI / 180
    const lon2 = coords[j].lon * Math.PI / 180
    area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2))
  }
  return Math.abs(area * 6378137 * 6378137 / 2)
}

async function fetchCompetitors(lat, lng) {
  const r = MILES_10_IN_METERS

  // Split into two lighter queries to avoid Overpass rate limits / timeouts
  // Query 1: OSM-tagged storage facilities (fast — uses indexed tags)
  const tagQuery = `[out:json][timeout:25];
(
  nwr["self_storage"](around:${r},${lat},${lng});
  nwr["amenity"="self_storage"](around:${r},${lat},${lng});
  nwr["shop"="storage_rental"](around:${r},${lat},${lng});
  nwr["industrial"="self_storage"](around:${r},${lat},${lng});
  nwr["landuse"="self_storage"](around:${r},${lat},${lng});
  nwr["building"="self_storage"](around:${r},${lat},${lng});
  nwr["self_storage"="yes"](around:${r},${lat},${lng});
  nwr["storage_type"~"self_storage|self-storage"](around:${r},${lat},${lng});
);
out geom 300;`

  // Query 2: Name-based search (lighter regex — just core patterns, no huge brand list)
  const nameQuery = `[out:json][timeout:25];
(
  nwr["name"~"self.?storage|mini.?storage|storage unit|storage facilit",i](around:${r},${lat},${lng});
  nwr["name"~"Public Storage|Extra Space|CubeSmart|Life Storage|U-Haul|Uncle Bob",i](around:${r},${lat},${lng});
);
out geom 200;`

  const servers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ]

  async function runQuery(query) {
    for (const server of servers) {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 20000) // 20s timeout per server
        const res = await fetch(server, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          signal: ctrl.signal
        })
        clearTimeout(timer)
        if (!res.ok) continue
        const d = await res.json()
        if (d.elements) return d.elements
      } catch { continue }
    }
    return []
  }

  // Run both queries in parallel for speed
  const [tagResults, nameResults] = await Promise.all([
    runQuery(tagQuery),
    runQuery(nameQuery)
  ])

  // Merge and deduplicate by OSM id
  const seen = new Set()
  const allElements = []
  for (const el of [...tagResults, ...nameResults]) {
    const key = `${el.type}-${el.id}`
    if (!seen.has(key)) {
      seen.add(key)
      allElements.push(el)
    }
  }

  if (allElements.length === 0) return []
  const data = { elements: allElements }

  const SQM_TO_SQFT = 10.7639

  // Process each element: extract name, position, area
  const raw = data.elements.map(e => {
    let centerLat, centerLon, areaSqft = null
    if (e.type === 'way' && e.geometry) {
      centerLat = e.geometry.reduce((s, c) => s + c.lat, 0) / e.geometry.length
      centerLon = e.geometry.reduce((s, c) => s + c.lon, 0) / e.geometry.length
      const areaM2 = polygonAreaSqM(e.geometry)
      const levels = parseInt(e.tags?.['building:levels']) || 1
      areaSqft = Math.round(areaM2 * SQM_TO_SQFT * levels)
      if (areaSqft < 200) areaSqft = null // filter noise
    } else if (e.type === 'relation' && e.bounds) {
      centerLat = (e.bounds.minlat + e.bounds.maxlat) / 2
      centerLon = (e.bounds.minlon + e.bounds.maxlon) / 2
    } else {
      centerLat = e.lat
      centerLon = e.lon
    }

    const name = e.tags?.name || e.tags?.brand || null
    const addr = [e.tags?.['addr:housenumber'], e.tags?.['addr:street']].filter(Boolean).join(' ')
    const city = e.tags?.['addr:city'] || ''
    const dist = haversine(lat, lng, centerLat, centerLon)

    return { name, addr, city, lat: centerLat, lon: centerLon, areaSqft, dist, osmId: e.id }
  }).filter(e => e.lat && e.dist <= 10.5) // small tolerance

  // Group nearby buildings with same name (within 0.15 miles / ~250m)
  const grouped = []
  const used = new Set()
  for (let i = 0; i < raw.length; i++) {
    if (used.has(i)) continue
    const facility = { ...raw[i], totalSqft: raw[i].areaSqft || 0, buildingCount: raw[i].areaSqft ? 1 : 0 }
    used.add(i)
    for (let j = i + 1; j < raw.length; j++) {
      if (used.has(j)) continue
      const sameName = facility.name && raw[j].name && facility.name === raw[j].name
      const nearby = haversine(facility.lat, facility.lon, raw[j].lat, raw[j].lon) < 0.15
      if (sameName || (!facility.name && !raw[j].name && nearby)) {
        facility.totalSqft += raw[j].areaSqft || 0
        if (raw[j].areaSqft) facility.buildingCount++
        if (!facility.name && raw[j].name) facility.name = raw[j].name
        if (!facility.addr && raw[j].addr) facility.addr = raw[j].addr
        if (!facility.city && raw[j].city) facility.city = raw[j].city
        used.add(j)
      }
    }
    if (!facility.name) facility.name = 'Self-Storage Facility'
    grouped.push(facility)
  }

  // Sort by distance
  grouped.sort((a, b) => a.dist - b.dist)
  return grouped
}

// Look up county FIPS from coordinates — try FCC API first, then Census TIGERweb
async function getCountyFromCoords(lat, lng) {
  // Method 1: FCC Area API
  try {
    const fccRes = await fetch(`https://geo.fcc.gov/api/census/area?lat=${lat}&lon=${lng}&format=json`)
    if (fccRes.ok) {
      const fccData = await fccRes.json()
      const fips = fccData?.results?.[0]?.county_fips
      const name = fccData?.results?.[0]?.county_name
      if (fips && fips.length >= 5) return { stateFips: fips.substring(0, 2), countyCode: fips.substring(2, 5), countyName: name }
    }
  } catch {}

  // Method 2: Census TIGERweb (same service we use for population)
  try {
    const tigerUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/82/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=STATE,COUNTY,BASENAME&f=json&returnGeometry=false`
    const tigerRes = await fetch(tigerUrl)
    if (tigerRes.ok) {
      const tigerData = await tigerRes.json()
      const feat = tigerData?.features?.[0]?.attributes
      if (feat?.STATE && feat?.COUNTY) {
        return { stateFips: feat.STATE, countyCode: feat.COUNTY, countyName: feat.BASENAME ? feat.BASENAME + ' County' : null }
      }
    }
  } catch {}

  return null
}

// Fetch Census CBP benchmark with multi-county radius adjustment
// Uses all counties in the state, weighted by how much they overlap the 10-mile search radius
async function fetchCensusBenchmark(lat, lng) {
  try {
    // Step 1: Get the property's county
    const homeCounty = await getCountyFromCoords(lat, lng)
    if (!homeCounty) return null

    // Step 2: Fetch county centroids + land areas from TIGERweb, and CBP data — in parallel
    let cbpData = null, cbpYear = null
    const [countyGeoRes, ...cbpResults] = await Promise.all([
      fetch(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/82/query?where=STATE=%27${homeCounty.stateFips}%27&outFields=STATE,COUNTY,BASENAME,CENTLAT,CENTLON,AREALAND&f=json&returnGeometry=false&resultRecordCount=200`).then(r => r.json()).catch(() => null),
      fetch(`https://api.census.gov/data/2022/cbp?get=ESTAB,NAICS2017&for=county:*&in=state:${homeCounty.stateFips}&NAICS2017=531130`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`https://api.census.gov/data/2021/cbp?get=ESTAB,NAICS2017&for=county:*&in=state:${homeCounty.stateFips}&NAICS2017=531130`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])

    // Use 2022, fall back to 2021
    if (cbpResults[0] && cbpResults[0].length > 1) { cbpData = cbpResults[0]; cbpYear = 2022 }
    else if (cbpResults[1] && cbpResults[1].length > 1) { cbpData = cbpResults[1]; cbpYear = 2021 }
    if (!cbpData) return null

    // Build lookup: county FIPS -> establishment count
    const cbpMap = {}
    for (let i = 1; i < cbpData.length; i++) {
      const estab = parseInt(cbpData[i][0])
      const countyCode = cbpData[i][cbpData[i].length - 1] // last field is county
      if (!isNaN(estab)) cbpMap[countyCode] = estab
    }

    // If we can't get geo data, fall back to single-county count
    const counties = countyGeoRes?.features?.map(f => f.attributes) || []
    if (counties.length === 0) {
      const singleCount = cbpMap[homeCounty.countyCode]
      return singleCount ? { radiusEstimate: singleCount, countyTotal: singleCount, county: homeCounty.countyName, year: cbpYear, method: 'county' } : null
    }

    // Step 3: For each county, calculate distance and overlap with 10-mile radius
    const SEARCH_RADIUS_MI = 10
    const searchAreaSqMi = Math.PI * SEARCH_RADIUS_MI * SEARCH_RADIUS_MI // ~314 sq mi
    const SQM_TO_SQMI = 3.861e-7
    let radiusEstimate = 0
    let countyTotal = 0 // home county total
    const contributingCounties = []

    for (const c of counties) {
      const estab = cbpMap[c.COUNTY] || 0
      if (estab === 0) continue

      const cLat = parseFloat(c.CENTLAT)
      const cLon = parseFloat(c.CENTLON)
      const areaLandSqMi = (parseInt(c.AREALAND) || 0) * SQM_TO_SQMI

      if (c.COUNTY === homeCounty.countyCode) countyTotal = estab

      // Distance from property to county centroid
      const distMi = haversine(lat, lng, cLat, cLon)

      // Estimate overlap: what fraction of this county's facilities are within our search radius?
      // Simple heuristic: if county centroid is within search radius, assume full overlap
      // If centroid is within 2x radius, assume partial overlap based on area intersection
      // Beyond 2x, assume zero overlap
      const countyRadiusMi = Math.sqrt(areaLandSqMi / Math.PI) // approx "radius" of county as circle
      let overlapFraction = 0

      if (distMi <= SEARCH_RADIUS_MI * 0.5) {
        // Property is deep inside this county — use area ratio
        overlapFraction = Math.min(1, searchAreaSqMi / areaLandSqMi)
      } else if (distMi <= SEARCH_RADIUS_MI + countyRadiusMi) {
        // Partial overlap — estimate based on distance
        const maxDist = SEARCH_RADIUS_MI + countyRadiusMi
        const overlapDist = maxDist - distMi
        overlapFraction = Math.min(1, (overlapDist / maxDist) * (searchAreaSqMi / areaLandSqMi))
      }
      // else: too far, overlapFraction stays 0

      if (overlapFraction > 0.01) {
        const contribution = estab * overlapFraction
        radiusEstimate += contribution
        contributingCounties.push({ name: c.BASENAME, count: estab, overlap: overlapFraction, contribution: Math.round(contribution) })
      }
    }

    return {
      radiusEstimate: Math.round(radiusEstimate),
      countyTotal,
      county: homeCounty.countyName,
      year: cbpYear,
      method: 'radius',
      contributingCounties
    }
  } catch {
    return null
  }
}

function CompetitorsSection({ address, city, state, areaPopulation }) {
  const [competitors, setCompetitors] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [censusBenchmark, setCensusBenchmark] = useState(null)
  const lastLookup = useRef('')

  // Reset results when the property changes
  useEffect(() => {
    const key = `${address}|${city}|${state}`
    if (key !== lastLookup.current) {
      setCompetitors(null)
      setError(null)
      setCensusBenchmark(null)
      lastLookup.current = ''
    }
  }, [address, city, state])

  // A real street address contains a number (e.g. "715 N Sandusky St") —
  // placeholder values like just the city name ("Dayton") don't count
  const hasAddress = address && address.trim().length > 0 && /\d/.test(address) && address.trim().toLowerCase() !== (city || '').trim().toLowerCase()
  const runSearch = () => {
    const key = `${address}|${city}|${state}`
    if (!city || !hasAddress) return
    lastLookup.current = key
    setLoading(true)
    setError(null)

    geocodeLocation(address, city, state)
      .then(coords => {
        if (!coords) throw new Error('Could not geocode location')
        // Run OSM competitor search and Census benchmark in parallel
        return Promise.all([
          fetchCompetitors(coords.lat, coords.lng),
          fetchCensusBenchmark(coords.lat, coords.lng)
        ])
      })
      .then(([data, benchmark]) => {
        setCompetitors(data)
        setCensusBenchmark(benchmark)
        setError(null)
      })
      .catch(err => setError(`Failed to fetch competitor data: ${err.message}`))
      .finally(() => setLoading(false))
  }

  const within5 = competitors?.filter(c => c.dist <= 5) || []
  const within10 = competitors?.filter(c => c.dist > 5 && c.dist <= 10) || []
  const totalSqft5 = within5.reduce((s, c) => s + (c.totalSqft || 0), 0)
  const totalSqft10 = within10.reduce((s, c) => s + (c.totalSqft || 0), 0)

  const renderTable = (items, label) => (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-xs font-semibold text-navy-600 uppercase">{label}</h5>
        <div className="flex items-center gap-3 text-xs text-navy-500">
          <span>{items.length} facilit{items.length === 1 ? 'y' : 'ies'}</span>
          {items.reduce((s, c) => s + (c.totalSqft || 0), 0) > 0 && (
            <span className="font-medium text-navy-700">
              ~{items.reduce((s, c) => s + (c.totalSqft || 0), 0).toLocaleString()} SF total
            </span>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-navy-400 italic">No storage facilities found</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy-50">
                <th className="px-3 py-2 text-left text-xs font-semibold text-navy-600">Facility</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-navy-600">Location</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-navy-600">Distance</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-navy-600">Est. SF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {items.map((c, i) => (
                <tr key={i} className="hover:bg-navy-50/50">
                  <td className="px-3 py-2 font-medium text-navy-800">
                    {c.name}
                    {c.buildingCount > 1 && <span className="text-[10px] text-navy-400 ml-1">({c.buildingCount} bldgs)</span>}
                  </td>
                  <td className="px-3 py-2 text-navy-500">{c.addr}{c.addr && c.city ? ', ' : ''}{c.city}</td>
                  <td className="px-3 py-2 text-right text-navy-600">{c.dist.toFixed(1)} mi</td>
                  <td className="px-3 py-2 text-right text-navy-600">
                    {c.totalSqft > 0 ? c.totalSqft.toLocaleString() : <span className="text-navy-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-navy-700 uppercase tracking-wide">Competitors</h4>
        <div className="flex items-center gap-2">
          {competitors && (
            <span className="text-xs text-navy-400 bg-navy-50 px-2 py-1 rounded">
              {(within5.length + within10.length)} found via OpenStreetMap
              {censusBenchmark && (
                <span className="ml-1 text-navy-500"> · Census est. ~{censusBenchmark.radiusEstimate} in 10-mi radius</span>
              )}
            </span>
          )}
          {competitors && !loading && (
            <button onClick={runSearch} className="text-xs text-blue-600 hover:text-blue-800 underline">Re-run</button>
          )}
        </div>
      </div>
      {!competitors && !loading && !error && (
        <div className="text-center py-4">
          {hasAddress ? (
            <>
              <p className="text-sm text-navy-500 mb-3">Search for self-storage competitors within 10 miles using OpenStreetMap data.</p>
              <button onClick={runSearch} disabled={!city} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                <span>🔍</span> Search Competitors
              </button>
            </>
          ) : (
            <p className="text-sm text-navy-400">Add a street address to this property to search for nearby competitors.</p>
          )}
        </div>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-navy-500 text-sm">
          <div className="animate-spin w-4 h-4 border-2 border-navy-300 border-t-blue-500 rounded-full" />
          Searching for storage facilities near {city}, {state}...
        </div>
      )}
      {error && !loading && (
        <div className="text-center py-2">
          <p className="text-sm text-navy-400 mb-2">{error}</p>
          <button onClick={runSearch} className="text-sm text-blue-600 hover:text-blue-800 underline">Try again</button>
        </div>
      )}
      {competitors && !loading && (
        <div>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="bg-navy-50 rounded-lg p-3">
              <div className="text-xs text-navy-500 mb-1">Within 5 miles</div>
              <div className="text-xl font-bold text-navy-900">{within5.length}</div>
              {totalSqft5 > 0 && <div className="text-xs text-navy-500">~{totalSqft5.toLocaleString()} SF competing</div>}
            </div>
            <div className="bg-navy-50 rounded-lg p-3">
              <div className="text-xs text-navy-500 mb-1">5–10 miles</div>
              <div className="text-xl font-bold text-navy-900">{within10.length}</div>
              {totalSqft10 > 0 && <div className="text-xs text-navy-500">~{totalSqft10.toLocaleString()} SF competing</div>}
            </div>
            {(() => {
              const totalSqftAll = totalSqft5 + totalSqft10
              const sqftPerCapita = areaPopulation && totalSqftAll > 0 ? (totalSqftAll / areaPopulation).toFixed(2) : null
              const benchmark = sqftPerCapita ? (sqftPerCapita >= 8 ? { label: 'Oversupplied', color: 'text-red-600' } : sqftPerCapita >= 6 ? { label: 'Balanced', color: 'text-amber-600' } : { label: 'Undersupplied', color: 'text-emerald-600' }) : null
              return (
                <div className="bg-navy-50 rounded-lg p-3">
                  <div className="text-xs text-navy-500 mb-1">SF per Capita</div>
                  {sqftPerCapita ? (
                    <>
                      <div className="text-xl font-bold text-navy-900">{sqftPerCapita}</div>
                      <div className={`text-xs font-medium ${benchmark.color}`}>{benchmark.label}</div>
                    </>
                  ) : (
                    <div className="text-sm text-navy-300">—</div>
                  )}
                </div>
              )
            })()}
            <div className="bg-navy-50 rounded-lg p-3">
              <div className="text-xs text-navy-500 mb-1">Census Estimate</div>
              {censusBenchmark ? (
                <>
                  <div className="text-xl font-bold text-navy-900">~{censusBenchmark.radiusEstimate}</div>
                  <div className="text-xs text-navy-500">
                    {censusBenchmark.method === 'radius' ? 'est. in 10-mi radius' : censusBenchmark.county} ({censusBenchmark.year})
                  </div>
                  {(() => {
                    const osmCount = within5.length + within10.length
                    const benchmark = censusBenchmark.radiusEstimate
                    const coverage = benchmark > 0 ? Math.round((osmCount / benchmark) * 100) : 0
                    return (
                      <div className={`text-xs font-medium mt-0.5 ${coverage >= 60 ? 'text-emerald-600' : coverage >= 30 ? 'text-amber-600' : 'text-red-600'}`}>
                        OSM coverage: {Math.min(coverage, 100)}%
                      </div>
                    )
                  })()}
                  {censusBenchmark.method === 'radius' && censusBenchmark.contributingCounties?.length > 1 && (
                    <div className="text-[10px] text-navy-400 mt-0.5">
                      {censusBenchmark.contributingCounties.map(c => `${c.name}: ~${c.contribution}`).join(' · ')}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-navy-300">—</div>
              )}
            </div>
          </div>
          {renderTable(within5, 'Within 5 miles')}
          {renderTable(within10, '5–10 miles')}
          <p className="text-[10px] text-navy-300 mt-2">Square footage estimated from building footprints. Actual leasable SF may vary. Facilities: OpenStreetMap. Census benchmark: NAICS 531130 via Census County Business Patterns.</p>
        </div>
      )}
    </div>
  )
}

function UnderwritingTab({ property, properties, onSelectProperty, onUpdateProperty, onDeleteProperty }) {
  const [mgmtFeePct, setMgmtFeePct] = useState(6)
  const [capExPct, setCapExPct] = useState(5)
  const [editingUrl, setEditingUrl] = useState(false)
  const [areaPopulation, setAreaPopulation] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const prop = property
  const uw = prop ? runUnderwriting(prop, mgmtFeePct / 100, capExPct / 100) : null

  const handlePropEdit = (key, val) => {
    const updated = { ...property, [key]: val }
    if (onUpdateProperty) onUpdateProperty(updated)
  }

  if (!prop) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-12 text-center">
        <div className="text-4xl mb-4">🏗️</div>
        <h3 className="text-xl font-semibold text-navy-900 mb-2">Select a Property to Underwrite</h3>
        <p className="text-navy-500 mb-6">Click "Underwrite →" on any property in the Buy Box tab, or select one below:</p>
        <div className="flex flex-wrap justify-center gap-2">
          {properties.map(p => (
            <button key={p.id} onClick={() => onSelectProperty(p)} className="text-sm bg-navy-100 text-navy-700 px-3 py-1.5 rounded-lg hover:bg-navy-200 transition">{p.name}</button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Property Header */}
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-navy-900">{prop.name}</h3>
              <Badge text={uw.verdict} variant={uw.verdict === 'PASS' ? 'pass' : uw.verdict === 'FAIL' ? 'fail' : 'pending'} />
            </div>
            <p className="text-navy-500 mt-1">{prop.address && prop.address !== prop.city ? `${prop.address}, ` : ''}{prop.city}, {prop.state} {prop.zip}</p>
            {prop.listingUrl && (
              <a href={prop.listingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 mt-1">
                <span>🔗</span> View Original Listing
              </a>
            )}
            {uw.reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {uw.reasons.map((r, i) => <span key={i} className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded">{r}</span>)}
              </div>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => handlePropEdit('verdictOverride', 'PASS')}
                className={`text-sm px-4 py-1.5 rounded-lg font-medium transition ${uw.verdict === 'PASS' ? 'bg-emerald-600 text-white' : 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50'}`}
              >
                ✓ Accept
              </button>
              <button
                onClick={() => handlePropEdit('verdictOverride', 'FAIL')}
                className={`text-sm px-4 py-1.5 rounded-lg font-medium transition ${uw.verdict === 'FAIL' ? 'bg-red-600 text-white' : 'border border-red-300 text-red-700 hover:bg-red-50'}`}
              >
                ✕ Reject
              </button>
              {uw.verdict !== 'PENDING' && (
                <button
                  onClick={() => handlePropEdit('verdictOverride', '')}
                  className="text-xs text-navy-400 hover:text-navy-600 ml-1"
                >
                  Reset to Pending
                </button>
              )}
              {uw.autoVerdict === 'PASS' && uw.verdict === 'PENDING' && (
                <span className="text-xs text-emerald-600 ml-2">Auto-analysis: meets all criteria</span>
              )}
              {uw.autoVerdict === 'FAIL' && uw.verdict === 'PENDING' && (
                <span className="text-xs text-amber-600 ml-2">Auto-analysis: has warnings</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <select className="border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop.id} onChange={e => { setEditingUrl(false); onSelectProperty(properties.find(p => p.id === +e.target.value)) }}>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name} — {fmt(p.purchasePrice)}</option>)}
            </select>
            {!showDeleteConfirm ? (
              <button onClick={() => setShowDeleteConfirm(true)} className="text-xs text-red-400 hover:text-red-600 transition">Delete Property</button>
            ) : (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <span className="text-xs text-red-700">Delete "{prop.name}"?</span>
                <button onClick={() => { onDeleteProperty(prop.id); setShowDeleteConfirm(false) }} className="text-xs bg-red-600 text-white px-2 py-1 rounded font-medium hover:bg-red-700 transition">Yes, Delete</button>
                <button onClick={() => setShowDeleteConfirm(false)} className="text-xs text-navy-500 hover:text-navy-700 px-2 py-1">Cancel</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Editable Inputs */}
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-6 mb-6">
        <h4 className="text-sm font-semibold text-navy-700 uppercase tracking-wide mb-4">Property Inputs</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-navy-500 mb-1">Property Name</label>
            <input type="text" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop.name || ''} onChange={e => handlePropEdit('name', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Address</label>
            <input type="text" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop.address || ''} onChange={e => handlePropEdit('address', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">City</label>
            <input type="text" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop.city || ''} onChange={e => handlePropEdit('city', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">State</label>
            <input type="text" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop.state || ''} onChange={e => handlePropEdit('state', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Zip</label>
            <input type="text" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop.zip || ''} onChange={e => handlePropEdit('zip', e.target.value)} />
          </div>
          {[
            ['purchasePrice', 'Purchase Price ($)', 'number'],
            ['unitCount', 'Units', 'number'],
            ['totalSF', 'Total SF', 'number'],
          ].map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-navy-500 mb-1">{label}</label>
              <input type="number" step="1" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop[key]} onChange={e => handlePropEdit(key, +e.target.value)} />
            </div>
          ))}
          {/* Avg Rent/Unit with area rate estimate */}
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Avg Rent/Unit ($/mo)</label>
            <div className="flex gap-1">
              <input type="number" step="1" className="flex-1 border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop.avgRentPerUnit} onChange={e => handlePropEdit('avgRentPerUnit', +e.target.value)} />
              {(() => {
                const est = getAreaRate(prop.city, prop.state)
                return (
                  <button
                    onClick={() => handlePropEdit('avgRentPerUnit', est.rate)}
                    title={`Use ${est.source}: $${est.rate}/mo (2025 industry data)`}
                    className="px-2 py-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition whitespace-nowrap"
                  >
                    ~${est.rate}
                  </button>
                )
              })()}
            </div>
            <p className="text-xs text-navy-400 mt-0.5">{getAreaRate(prop.city, prop.state).source} (2025)</p>
          </div>
          {[
            ['occupancyRate', 'Occupancy Rate', 'number'],
            ['operatingExpenses', 'Operating Expenses ($/yr)', 'number'],
            ['propertyTax', 'Property Tax ($/yr)', 'number'],
            ['insurance', 'Insurance ($/yr)', 'number'],
          ].map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-navy-500 mb-1">{label}</label>
              <input type="number" step={key === 'occupancyRate' ? '0.01' : '1'} className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop[key]} onChange={e => handlePropEdit(key, +e.target.value)} />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">Mgmt Fee (%)</label>
            <input type="number" step="0.5" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={mgmtFeePct} onChange={e => setMgmtFeePct(+e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-500 mb-1">CapEx Reserve (%)</label>
            <input type="number" step="0.5" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={capExPct} onChange={e => setCapExPct(+e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-navy-500 mb-1">Listing URL</label>
            {prop.listingUrl && !editingUrl ? (
              <div className="flex items-center gap-2 border border-navy-200 rounded-lg px-3 py-2 text-sm bg-navy-50">
                <a href={prop.listingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 truncate flex-1">{prop.listingUrl}</a>
                <button onClick={() => setEditingUrl(true)} className="text-navy-400 hover:text-navy-600 text-xs whitespace-nowrap">✏️ Edit</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input type="url" placeholder="https://..." className="flex-1 border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={prop.listingUrl || ''} onChange={e => handlePropEdit('listingUrl', e.target.value)} />
                {prop.listingUrl && <button onClick={() => setEditingUrl(false)} className="text-sm text-navy-500 hover:text-navy-700 px-2">Done</button>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Gross Potential Income" value={fmt(uw.gpi)} sub="Annual (100% occupied)" />
        <MetricCard label="Effective Gross Income" value={fmt(uw.egi)} sub={`At ${pct(prop.occupancyRate)} occupancy`} />
        <MetricCard label="Net Operating Income" value={fmt(uw.noi)} color={uw.noi > 0 ? "text-emerald-600" : "text-red-600"} sub="After all expenses" />
        <MetricCard label="Cap Rate" value={pct(uw.capRate)} color={uw.capRate >= 0.07 ? "text-emerald-600" : uw.capRate >= 0.06 ? "text-amber-600" : "text-red-600"} sub="NOI / Purchase Price" />
        <MetricCard label="Expense Ratio" value={pct(uw.expenseRatio)} color={uw.expenseRatio <= 0.35 ? "text-emerald-600" : uw.expenseRatio <= 0.40 ? "text-amber-600" : "text-red-600"} sub="Expenses / EGI" />
        <MetricCard label="Cash-on-Cash" value={pct(uw.scenarios[2].cashOnCash)} color={uw.scenarios[2].cashOnCash >= 0.08 ? "text-emerald-600" : uw.scenarios[2].cashOnCash >= 0 ? "text-amber-600" : "text-red-600"} sub="Conventional scenario" />
        <MetricCard label="Break-even Occ." value={pct(uw.breakEvenOcc)} color={uw.breakEvenOcc <= 0.60 ? "text-emerald-600" : uw.breakEvenOcc <= 0.75 ? "text-amber-600" : "text-red-600"} sub="Min occupancy for NOI > 0" />
        <MetricCard label="Price / Unit" value={fmt(uw.pricePerUnit)} />
        <MetricCard label="Price / SF" value={fmtFull(uw.pricePerSF)} />
        <MetricCard label="Revenue / SF" value={`$${uw.revenuePerSF.toFixed(2)}`} sub="Annualized EGI per SF" />
        <MetricCard label="Total Expenses" value={fmt(uw.totalOpEx)} sub={`Mgmt: ${fmt(uw.mgmtFee)} | CapEx: ${fmt(uw.capEx)}`} />
        <MetricCard label="CapEx / SF" value={`$${(prop.totalSF > 0 ? uw.capEx / prop.totalSF : 0).toFixed(2)}`} sub="Annual reserve per SF" />
      </div>

      {/* Market Demand */}
      <MarketDemandSection address={prop.address} city={prop.city} state={prop.state} onPopulationLoaded={setAreaPopulation} />

      {/* Competitors */}
      <CompetitorsSection address={prop.address} city={prop.city} state={prop.state} areaPopulation={areaPopulation} />

      {/* Financing Scenarios */}
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 overflow-hidden">
        <h4 className="text-sm font-semibold text-navy-700 uppercase tracking-wide px-6 pt-5 pb-3">Financing Scenario Comparison</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-navy-50">
              <tr>
                {['Metric', 'Seller Financed', 'SBA 7(a)', 'Conventional', 'Cash Offer'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-navy-600 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {[
                ['Down Payment', s => `${fmt(s.downPayment)} (${pct(s.downPct)})`],
                ['Loan Amount', s => s.loanAmount > 0 ? fmt(s.loanAmount) : '—'],
                ['Interest Rate', s => s.rate > 0 ? pct(s.rate) : '—'],
                ['Loan Term', s => s.years > 0 ? `${s.years} years` : '—'],
                ['Monthly Payment', s => s.monthlyPayment > 0 ? fmtFull(s.monthlyPayment) : '—'],
                ['Annual Debt Service', s => s.annualDebt > 0 ? fmt(s.annualDebt) : '—'],
                ['Annual Cash Flow', s => <span className={s.cashFlow >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>{fmt(s.cashFlow)}</span>],
                ['DSCR', s => s.dscr === Infinity ? '—' : <span className={s.dscr >= 1.25 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>{s.dscr.toFixed(2)}x</span>],
                ['Cash-on-Cash Return', s => <span className={s.cashOnCash >= 0.08 ? 'text-emerald-600 font-semibold' : 'text-navy-700 font-semibold'}>{pct(s.cashOnCash)}</span>],
                ['Total Cash Needed', s => fmt(s.totalCashNeeded)],
                ['Earnest Money', s => fmt(s.earnestMoney)],
              ].map(([label, fn], i) => (
                <tr key={i} className="hover:bg-navy-50">
                  <td className="px-4 py-2.5 font-medium text-navy-700">{label}</td>
                  {uw.scenarios.map((s, j) => <td key={j} className="px-4 py-2.5">{fn(s)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── OFFER LETTERS TAB ──────────────────────────────────────────────────────
function OfferLettersTab({ property, properties, onSelectProperty }) {
  const [selectedScenario, setSelectedScenario] = useState(0)
  const [buyerName, setBuyerName] = useState('')
  const [buyerAddress, setBuyerAddress] = useState('')
  const [sellerName, setSellerName] = useState('')
  const [copied, setCopied] = useState(false)

  const prop = property
  if (!prop) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-12 text-center">
        <div className="text-4xl mb-4">📝</div>
        <h3 className="text-xl font-semibold text-navy-900 mb-2">Select a Property First</h3>
        <p className="text-navy-500 mb-6">Go to the Buy Box tab and click "Underwrite →" on a property, then come back here to generate offer letters.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {properties.map(p => (
            <button key={p.id} onClick={() => onSelectProperty(p)} className="text-sm bg-navy-100 text-navy-700 px-3 py-1.5 rounded-lg hover:bg-navy-200 transition">{p.name}</button>
          ))}
        </div>
      </div>
    )
  }

  const uw = runUnderwriting(prop)
  const scenario = uw.scenarios[selectedScenario]
  const letter = generateOfferLetter(prop, scenario, buyerName, buyerAddress, sellerName)

  const handleDownload = () => {
    const blob = new Blob([letter], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `LOI_${prop.name.replace(/\s+/g, '_')}_${scenario.name.replace(/\s+/g, '_')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(letter)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-6 mb-6">
        <h3 className="text-lg font-semibold text-navy-900 mb-4">Generate Offer Letter — {prop.name}</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Offer Type</label>
            <select className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={selectedScenario} onChange={e => setSelectedScenario(+e.target.value)}>
              <option value={0}>Seller Financed</option>
              <option value={1}>SBA 7(a)</option>
              <option value={2}>Conventional</option>
              <option value={3}>Cash Offer</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Your Name</label>
            <input type="text" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="John Manner" value={buyerName} onChange={e => setBuyerName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Your Address</label>
            <input type="text" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="123 Main St, Columbus OH" value={buyerAddress} onChange={e => setBuyerAddress(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Seller Name</label>
            <input type="text" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="Property Owner" value={sellerName} onChange={e => setSellerName(e.target.value)} />
          </div>
        </div>

        {/* Quick summary */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-navy-50 rounded-lg p-3">
            <p className="text-xs text-navy-500">Offer Price</p>
            <p className="text-lg font-bold text-navy-900">{fmt(selectedScenario === 2 ? Math.round(prop.purchasePrice * 0.875) : prop.purchasePrice)}</p>
          </div>
          <div className="bg-navy-50 rounded-lg p-3">
            <p className="text-xs text-navy-500">Down Payment</p>
            <p className="text-lg font-bold text-navy-900">{fmt(scenario.downPayment)}</p>
          </div>
          <div className="bg-navy-50 rounded-lg p-3">
            <p className="text-xs text-navy-500">Earnest Money</p>
            <p className="text-lg font-bold text-navy-900">{fmt(scenario.earnestMoney)}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={handleDownload} className="bg-navy-800 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-navy-900 transition flex items-center gap-2">
            <span>↓</span> Download .txt
          </button>
          <button onClick={handleCopy} className="border border-navy-200 text-navy-700 px-5 py-2.5 rounded-lg font-medium hover:bg-navy-50 transition">
            {copied ? '✓ Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
      </div>

      {/* Letter Preview */}
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-navy-100">
          <h4 className="text-sm font-semibold text-navy-700 uppercase tracking-wide">Letter Preview</h4>
        </div>
        <pre className="p-6 text-sm text-navy-800 whitespace-pre-wrap font-mono leading-relaxed bg-navy-50/50 max-h-[600px] overflow-y-auto">{letter}</pre>
      </div>
    </div>
  )
}

// ─── SUPABASE PERSISTENCE ───────────────────────────────────────────────────
// Convert JS property object → Supabase row (camelCase → snake_case)
function toDbRow(prop) {
  return {
    name: prop.name || '',
    address: prop.address || '',
    city: prop.city || '',
    state: prop.state || loadSettings().defaultState,
    zip: prop.zip || '',
    purchase_price: prop.purchasePrice || 0,
    unit_count: prop.unitCount || 0,
    total_sf: prop.totalSF || 0,
    occupancy_rate: prop.occupancyRate || 0.85,
    avg_rent_per_unit: prop.avgRentPerUnit || 0,
    operating_expenses: prop.operatingExpenses || 0,
    property_tax: prop.propertyTax || 0,
    insurance: prop.insurance || 0,
    listing_url: prop.listingUrl || '',
    verdict_override: prop.verdictOverride || '',
    notes: prop.notes || '',
    source: prop.source || '',
    imported: !!prop.imported,
    updated_at: new Date().toISOString(),
  }
}

// Convert Supabase row → JS property object (snake_case → camelCase)
function fromDbRow(row) {
  return {
    id: String(row.id),
    name: row.name || '',
    address: row.address || '',
    city: row.city || '',
    state: row.state || loadSettings().defaultState,
    zip: row.zip || '',
    purchasePrice: Number(row.purchase_price) || 0,
    unitCount: Number(row.unit_count) || 0,
    totalSF: Number(row.total_sf) || 0,
    occupancyRate: Number(row.occupancy_rate) || 0.85,
    avgRentPerUnit: Number(row.avg_rent_per_unit) || 0,
    operatingExpenses: Number(row.operating_expenses) || 0,
    propertyTax: Number(row.property_tax) || 0,
    insurance: Number(row.insurance) || 0,
    listingUrl: row.listing_url || '',
    verdictOverride: row.verdict_override || '',
    notes: row.notes || '',
    source: row.source || '',
    imported: row.imported,
  }
}

// Load all properties from Supabase
async function loadPropertiesFromDb() {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .neq('name', SETTINGS_ROW_NAME)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data || []).map(fromDbRow)
  } catch (e) {
    console.error('Failed to load from Supabase:', e)
    return []
  }
}

// Upsert a single property to Supabase (insert or update)
async function savePropertyToDb(prop) {
  try {
    const row = toDbRow(prop)
    // If prop.id is numeric (came from DB), update; otherwise insert
    if (prop._dbId) {
      const { error } = await supabase
        .from('properties')
        .update(row)
        .eq('id', prop._dbId)
      if (error) throw error
      return prop._dbId
    } else {
      const { data, error } = await supabase
        .from('properties')
        .insert(row)
        .select('id')
        .single()
      if (error) throw error
      return data.id
    }
  } catch (e) {
    console.error('Failed to save to Supabase:', e)
    return null
  }
}

// Delete a property from Supabase
async function deletePropertyFromDb(dbId) {
  try {
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', dbId)
    if (error) throw error
  } catch (e) {
    console.error('Failed to delete from Supabase:', e)
  }
}

// Save all properties in bulk (used for initial sync)
async function syncAllToDb(properties) {
  for (const prop of properties) {
    await savePropertyToDb(prop)
  }
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────
// ─── SETTINGS TAB ───────────────────────────────────────────────────────────
function SettingsTab({ settings, onSave }) {
  const [form, setForm] = useState({ ...settings })
  const [geocoding, setGeocoding] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleGeocode = async () => {
    if (!form.homeCity) return
    setGeocoding(true)
    try {
      const query = `${form.homeCity}, ${form.homeState} ${form.homeZip}`.trim()
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=1`, {
        headers: { 'User-Agent': 'StorageVault/1.0' }
      })
      const data = await resp.json()
      if (data.length > 0) {
        setForm(f => ({ ...f, homeLat: parseFloat(parseFloat(data[0].lat).toFixed(4)), homeLng: parseFloat(parseFloat(data[0].lon).toFixed(4)) }))
      }
    } catch {}
    setGeocoding(false)
  }

  const handleSave = () => {
    onSave(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-2xl">
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-6 mb-6">
        <h3 className="text-lg font-semibold text-navy-900 mb-1">Home Base Location</h3>
        <p className="text-sm text-navy-500 mb-4">Distances to properties are calculated from this location. This is also the default state for new properties.</p>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">City</label>
            <input type="text" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form.homeCity} onChange={e => setForm(f => ({ ...f, homeCity: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">State</label>
            <input type="text" maxLength={2} className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none uppercase" value={form.homeState} onChange={e => setForm(f => ({ ...f, homeState: e.target.value.toUpperCase(), defaultState: e.target.value.toUpperCase() }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Zip</label>
            <input type="text" maxLength={5} className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form.homeZip} onChange={e => setForm(f => ({ ...f, homeZip: e.target.value }))} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Latitude</label>
            <input type="number" step="0.0001" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-navy-50" value={form.homeLat} onChange={e => setForm(f => ({ ...f, homeLat: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Longitude</label>
            <input type="number" step="0.0001" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-navy-50" value={form.homeLng} onChange={e => setForm(f => ({ ...f, homeLng: parseFloat(e.target.value) || 0 }))} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleGeocode} disabled={geocoding || !form.homeCity} className="text-sm px-4 py-2 border border-navy-200 text-navy-700 rounded-lg hover:bg-navy-50 transition disabled:opacity-50">
            {geocoding ? 'Looking up...' : 'Auto-detect Coordinates'}
          </button>
          <span className="text-xs text-navy-400">Updates lat/lng from city, state, zip</span>
        </div>
      </div>

      {/* Underwriting Thresholds */}
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-6 mb-6">
        <h3 className="text-lg font-semibold text-navy-900 mb-1">Underwriting Thresholds</h3>
        <p className="text-sm text-navy-500 mb-4">Properties are flagged when they fall outside these thresholds.</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Min Cap Rate (%)</label>
            <input type="number" step="0.5" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form.minCapRate} onChange={e => setForm(f => ({ ...f, minCapRate: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Max Expense Ratio (%)</label>
            <input type="number" step="1" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form.maxExpenseRatio} onChange={e => setForm(f => ({ ...f, maxExpenseRatio: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Min DSCR</label>
            <input type="number" step="0.05" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form.minDSCR} onChange={e => setForm(f => ({ ...f, minDSCR: parseFloat(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Min Occupancy (%)</label>
            <input type="number" step="1" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form.minOccupancy} onChange={e => setForm(f => ({ ...f, minOccupancy: parseFloat(e.target.value) || 0 }))} />
          </div>
        </div>
      </div>

      {/* Financing Scenarios */}
      <div className="bg-white rounded-xl shadow-sm border border-navy-100 p-6 mb-6">
        <h3 className="text-lg font-semibold text-navy-900 mb-1">Financing Scenarios</h3>
        <p className="text-sm text-navy-500 mb-4">Default rates and terms used in underwriting calculations.</p>

        <div className="space-y-4">
          {[
            { label: 'Seller Financed', rateKey: 'sellerRate', downKey: 'sellerDown', yearsKey: 'sellerYears' },
            { label: 'SBA 7(a)', rateKey: 'sbaRate', downKey: 'sbaDown', yearsKey: 'sbaYears' },
            { label: 'Conventional', rateKey: 'conventionalRate', downKey: 'conventionalDown', yearsKey: 'conventionalYears' },
          ].map(({ label, rateKey, downKey, yearsKey }) => (
            <div key={rateKey} className="grid grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-xs font-semibold text-navy-700 mb-1">{label}</label>
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-600 mb-1">Rate (%)</label>
                <input type="number" step="0.25" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form[rateKey]} onChange={e => setForm(f => ({ ...f, [rateKey]: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-600 mb-1">Down (%)</label>
                <input type="number" step="1" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form[downKey]} onChange={e => setForm(f => ({ ...f, [downKey]: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-600 mb-1">Term (yrs)</label>
                <input type="number" step="1" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form[yearsKey]} onChange={e => setForm(f => ({ ...f, [yearsKey]: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
          ))}
          <div className="grid grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-xs font-semibold text-navy-700 mb-1">Cash Offer</label>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-navy-600 mb-1">Earnest Money (%)</label>
              <input type="number" step="1" className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" value={form.cashEarnest} onChange={e => setForm(f => ({ ...f, cashEarnest: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div></div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="bg-navy-800 text-white text-sm px-6 py-2.5 rounded-lg font-medium hover:bg-navy-900 transition">
          Save Settings
        </button>
        {saved && <span className="text-sm text-emerald-600 font-medium">Saved!</span>}
      </div>
    </div>
  )
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState(0)
  const [properties, setProperties] = useState([])
  const [selectedProperty, setSelectedProperty] = useState(null)
  const [settings, setSettings] = useState(loadSettings)
  const [dbLoaded, setDbLoaded] = useState(false)
  // Map local property IDs → Supabase row IDs
  const dbIdMap = useRef({})

  // Load all properties and settings from Supabase on mount
  useEffect(() => {
    loadPropertiesFromDb().then(rows => {
      const loaded = rows.map(row => {
        const localId = 'db-' + row.id
        dbIdMap.current[localId] = parseInt(row.id)
        return { ...row, id: localId, _dbId: parseInt(row.id) }
      })
      setProperties(loaded)
      setDbLoaded(true)
    })
    // Load settings from Supabase and merge with localStorage cache
    loadSettingsFromDb().then(dbSettings => {
      if (dbSettings) setSettings(dbSettings)
    })
  }, [])

  const allProperties = properties

  const handleSetProperties = useCallback((updater) => {
    if (typeof updater === 'function') {
      setProperties(prev => {
        const allNew = updater(prev)
        const oldIds = new Set(prev.map(p => p.id))
        const newlyAdded = allNew.filter(p => !oldIds.has(p.id))
        // Save new properties to Supabase
        newlyAdded.forEach(prop => {
          savePropertyToDb(prop).then(dbId => {
            if (dbId) dbIdMap.current[prop.id] = dbId
          })
        })
        return allNew
      })
    } else {
      updater.forEach(prop => {
        if (!dbIdMap.current[prop.id]) {
          savePropertyToDb(prop).then(dbId => {
            if (dbId) dbIdMap.current[prop.id] = dbId
          })
        }
      })
      setProperties(updater)
    }
  }, [])

  const handleSelectProperty = useCallback((p) => {
    setSelectedProperty(p)
    setTab(1)
  }, [])

  const handleUpdateProperty = useCallback((updated) => {
    setSelectedProperty(updated)
    // Save to Supabase
    const dbId = dbIdMap.current[updated.id] || updated._dbId
    const propToSave = dbId ? { ...updated, _dbId: dbId } : updated
    savePropertyToDb(propToSave).then(newDbId => {
      if (newDbId) dbIdMap.current[updated.id] = newDbId
    })
    // Update in properties list
    setProperties(prev => prev.map(p => p.id === updated.id ? updated : p))
  }, [])

  const handleDeleteProperty = useCallback((id) => {
    // Delete from Supabase if it has a DB record
    const dbId = dbIdMap.current[id]
    if (dbId) deletePropertyFromDb(dbId)
    // Remove from properties list
    setProperties(prev => prev.filter(p => p.id !== id))
    // Clear selection
    setSelectedProperty(prev => prev && prev.id === id ? null : prev)
  }, [])

  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings)
    saveSettingsToDb(newSettings)
  }

  const tabs = [
    { label: 'Buy Box & Deals', icon: '🎯' },
    { label: 'Underwriting', icon: '📊' },
    { label: 'Offer Letters', icon: '📝' },
    { label: 'Settings', icon: '⚙️' },
  ]

  // Dashboard stats
  const passCount = allProperties.filter(p => p.verdictOverride === 'PASS').length

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-50 to-navy-100">
      {/* Header */}
      <header className="bg-navy-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center text-xl font-bold text-navy-900">SV</div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">StorageVault</h1>
              <p className="text-navy-300 text-xs">Self-Storage Underwriting Tool</p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <div className="text-center">
              <p className="text-navy-300 text-xs">Properties</p>
              <p className="font-bold text-lg">{allProperties.length}</p>
            </div>
            <div className="text-center">
              <p className="text-navy-300 text-xs">Pass</p>
              <p className="font-bold text-lg text-emerald-400">{passCount}</p>
            </div>
            {selectedProperty && (
              <div className="text-center border-l border-navy-700 pl-6">
                <p className="text-navy-300 text-xs">Selected</p>
                <p className="font-semibold text-sm">{selectedProperty.name}</p>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-navy-200 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            {tabs.map((t, i) => (
              <button key={i} onClick={() => setTab(i)}
                className={`px-5 py-3.5 text-sm font-medium transition border-b-2 ${tab === i ? 'border-navy-800 text-navy-900' : 'border-transparent text-navy-500 hover:text-navy-700 hover:border-navy-300'}`}>
                <span className="mr-1.5">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {tab === 0 && <BuyBoxTab properties={allProperties} setProperties={handleSetProperties} onSelectProperty={handleSelectProperty} />}
        {tab === 1 && <UnderwritingTab property={selectedProperty} properties={allProperties} onSelectProperty={setSelectedProperty} onUpdateProperty={handleUpdateProperty} onDeleteProperty={handleDeleteProperty} />}
        {tab === 2 && <OfferLettersTab property={selectedProperty} properties={allProperties} onSelectProperty={(p) => { setSelectedProperty(p); setTab(2) }} />}
        {tab === 3 && <SettingsTab settings={settings} onSave={handleSaveSettings} />}
      </main>

      {/* Footer */}
      <footer className="bg-navy-900 text-navy-400 text-center py-4 text-xs mt-12">
        StorageVault — Self-Storage Underwriting Tool — For educational purposes only. Not financial advice.
      </footer>
    </div>
  )
}
