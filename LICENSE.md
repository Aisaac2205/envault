# EnVault Licensing Architecture

Copyright (c) 2026 Adán Isaac Sarceño Flores.

This repository is organized as a monorepo with distinct licensing terms for different packages, directories, and assets:

---

## 1. Proprietary Components & Assets (All Rights Reserved)

The following components are **PROPRIETARY** and all rights are strictly reserved by Adán Isaac Sarceño Flores:

* **Landing Website**: Everything located in [`apps/landing/`](apps/landing/) (including code, design, styling, layout, canvas shaders/effects, and copywriting). See [`apps/landing/LICENSE.md`](apps/landing/LICENSE.md).
* **Brand Assets & Identity**: The names "EnVault", "EnVault Management", official logos, icons, graphics, and trademarked visuals.

### Prohibitions:
* You **may not** copy, replicate, clone, or redistribute the landing page or its visual design.
* You **may not** host, deploy, or publish `apps/landing` on any domain, server, or cloud hosting service.
* You **may not** use the EnVault brand, logos, or identity to promote third-party products, services, or forks.

---

## 2. Core Tool & Platform Software (Fair Source, FSL-1.1-ALv2)

The core database backup and management platform is licensed under the **Functional Source License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2)** set forth below. This license covers:

* [`apps/api/`](apps/api/) and [`apps/web/`](apps/web/), the core platform.
* [`e2e/`](e2e/), the end-to-end test suite.
* The root workspace: the remaining files outside `apps/` and `e2e/` (configuration, scripts, and documentation), except the brand assets listed in section 1.

### Summary:
* ✅ **You may**: Use, copy, modify, and self-host the software; use it internally, including for commercial purposes; and use it to provide professional services to your clients.
* ❌ **You may NOT**: Offer the software, or a product or service with the same or substantially similar functionality, to third parties as a commercial product or service (including a hosted or SaaS offering) without a separate agreement.
* **Future license**: Each version becomes available under the Apache License, Version 2.0, two years after it is released.

Versions released before this change remain available under the license they were released with.

To offer EnVault as a hosted, SaaS, or other commercial product or service, or for custom agreements, please contact the author via GitHub: https://github.com/Aisaac2205

---

# Functional Source License, Version 1.1, ALv2 Future License

## Abbreviation

FSL-1.1-ALv2

## Notice

Copyright 2026 Adán Isaac Sarceño Flores

## Terms and Conditions

### Licensor ("We")

The party offering the Software under these Terms and Conditions.

### The Software

The "Software" is each version of the software that we make available under
these Terms and Conditions, as indicated by our inclusion of these Terms and
Conditions with the Software.

### License Grant

Subject to your compliance with this License Grant and the Patents,
Redistribution and Trademark clauses below, we hereby grant you the right to
use, copy, modify, create derivative works, publicly perform, publicly display
and redistribute the Software for any Permitted Purpose identified below.

### Permitted Purpose

A Permitted Purpose is any purpose other than a Competing Use. A Competing Use
means making the Software available to others in a commercial product or
service that:

1. substitutes for the Software;

2. substitutes for any other product or service we offer using the Software
   that exists as of the date we make the Software available; or

3. offers the same or substantially similar functionality as the Software.

Permitted Purposes specifically include using the Software:

1. for your internal use and access;

2. for non-commercial education;

3. for non-commercial research; and

4. in connection with professional services that you provide to a licensee
   using the Software in accordance with these Terms and Conditions.

### Patents

To the extent your use for a Permitted Purpose would necessarily infringe our
patents, the license grant above includes a license under our patents. If you
make a claim against any party that the Software infringes or contributes to
the infringement of any patent, then your patent license to the Software ends
immediately.

### Redistribution

The Terms and Conditions apply to all copies, modifications and derivatives of
the Software.

If you redistribute any copies, modifications or derivatives of the Software,
you must include a copy of or a link to these Terms and Conditions and not
remove any copyright notices provided in or with the Software.

### Disclaimer

THE SOFTWARE IS PROVIDED "AS IS" AND WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF FITNESS FOR A PARTICULAR
PURPOSE, MERCHANTABILITY, TITLE OR NON-INFRINGEMENT.

IN NO EVENT WILL WE HAVE ANY LIABILITY TO YOU ARISING OUT OF OR RELATED TO THE
SOFTWARE, INCLUDING INDIRECT, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES,
EVEN IF WE HAVE BEEN INFORMED OF THEIR POSSIBILITY IN ADVANCE.

### Trademarks

Except for displaying the License Details and identifying us as the origin of
the Software, you have no right under these Terms and Conditions to use our
trademarks, trade names, service marks or product names.

## Grant of Future License

We hereby irrevocably grant you an additional license to use the Software under
the Apache License, Version 2.0 that is effective on the second anniversary of
the date we make the Software available. On or after that date, you may use the
Software under the Apache License, Version 2.0, in which case the following
will apply:

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License.

You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
