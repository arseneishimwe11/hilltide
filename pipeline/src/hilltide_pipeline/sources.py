"""The open datasets Hilltide is built from: license and required credit.

These entries are copied into the manifest, and the site's credits section
is generated from them. Each license was read from the publisher's own
license page; docs/LICENSES.md records where and when.
"""

from __future__ import annotations

SOURCES: dict[str, dict] = {
    "copernicus-dem": {
        "name": "Copernicus DEM GLO-30 and GLO-90",
        "publisher": "European Space Agency, DLR, Airbus Defence and Space",
        "license": "Copernicus DEM free licence (credit required)",
        "licenseUrl": "https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
        "url": "https://registry.opendata.aws/copernicus-dem/",
        "attribution": (
            "Produced using Copernicus WorldDEM-30 and WorldDEM-90 "
            "\u00a9 DLR e.V. 2010-2014 and \u00a9 Airbus Defence and Space GmbH 2014-2018 "
            "provided under COPERNICUS by the European Union and ESA; all rights reserved."
        ),
    },
    "open-buildings": {
        "name": "Open Buildings v3 (building footprints)",
        "publisher": "Google Research",
        "license": "CC BY 4.0 (also offered under ODbL 1.0; used here under CC BY 4.0)",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "url": "https://sites.research.google/gr/open-buildings/",
        "attribution": (
            "W. Sirko, S. Kashubin, M. Ritter, A. Annkah, Y.S.E. Bouchareb, Y. Dauphin, "
            "D. Keysers, M. Neumann, M. Cisse, J.A. Quinn. Continental-scale building "
            "detection from high resolution satellite imagery. arXiv:2107.12283, 2021. "
            "Open Buildings v3, Google Research, CC BY 4.0."
        ),
    },
    "open-buildings-temporal": {
        "name": "Open Buildings 2.5D Temporal (annual presence and height, 2016 to 2023)",
        "publisher": "Google Research",
        "license": "CC BY 4.0 (also offered under ODbL 1.0; used here under CC BY 4.0)",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "url": "https://sites.research.google/gr/open-buildings/temporal/",
        "attribution": (
            "W. Sirko, E.A. Brempong, J.T.C. Marcos, A. Annkah, A. Korme, M.A. Hassen, "
            "K. Sapkota, T. Shekel, A. Diack, S. Nevo, J. Hickey, J. Quinn. High-Resolution "
            "Building and Road Detection from Sentinel-2. arXiv:2310.11622, 2023. Open "
            "Buildings 2.5D Temporal, Google Research, CC BY 4.0. Contains modified "
            "Copernicus Sentinel data (2016-2023)."
        ),
    },
    "openstreetmap": {
        "name": "OpenStreetMap (waterways, boundaries, place names)",
        "publisher": "OpenStreetMap contributors",
        "license": "ODbL 1.0 (share-alike for derived databases)",
        "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "url": "https://www.openstreetmap.org/copyright",
        "attribution": (
            "\u00a9 OpenStreetMap contributors, available under the Open Database License."
        ),
    },
    "esa-worldcover": {
        "name": "ESA WorldCover 10 m 2021 v200 (land cover)",
        "publisher": "European Space Agency",
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "url": "https://esa-worldcover.org/en/data-access",
        "attribution": (
            "\u00a9 ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data "
            "(2021) processed by ESA WorldCover consortium."
        ),
    },
}
