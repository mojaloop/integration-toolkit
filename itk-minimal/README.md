# ITK Minimal

ITK Minimal is a minimal, shrink wrapped package of components that enable technical connection setup and maintenance
between a Mojaloop scheme participant and a Mojaloop hub.

## Components

- **Mojaloop Connector**

  Formally know as the Mojaloop SDK Scheme Adapter, this component implements the secure bi-directional connection to
  the Mojaloop Hub:
    - Mutually authenticated (via X.509 PKI certificates) TLS connection from DFSP to hub.
    - Mutually authenticated (via X.509 PKI certificates) TLS connection from hub to DFSP.
    - JWS (JSON Web Signature) signing and signature validation for incoming and outgoing messages to and from the hub.
    - ILP (Interledger Protocol) packet, condition and fulfilment generation and validation.
    - Adaption between asynchronous Mojaloop API and a synchronous integration API.

- **Core Connector**

  Chose from a library of connectors for commonly used core banking system backends:
    - Simple integrations with low-code apache camel based connectors for many common fintech backends e.g.
        - a
        - b
        - c
    - Simplified custom backend integrations starting from common template for RESTish APIs.

- **ITK Configurator**

  A simple command line interface for configuring and managing the integration components:
    - Configure all Mojaloop Connector and Core Connector settings from a single interface.
    - Monitor the status of the connection to the hub and backend.

## Installation & Deployment Options

1. **Install onto a bare metal server, PC or VM from an ISO image**

   Choose this option if you have a suitable server, PC or virtual machine available and want to make it a dedicated
   integration point:
    - Installs a well known and supported linux operating system (overwrites any existing installations).
    - Sets up the operating system firewall automatically to a default secure configuration.
    - Installs ITK components as above.
    - Installs all necessary dependencies.

   [Find downloads and installation instructions here](./README.md).

   **_Please note that this option will erase all existing data from the machine._**


2. **Install onto an existing Linux server, PC or virtual machine**

   Choose this option if you have a suitable Linux server, PC or virtual machine available and want to install
   integration components alongside other existing applications:
    - Leaves existing applications and data untouched.
    - Installs ITK components as above.
    - Requires manual setup of the operating system firewall to a secure configuration.
    - Requires manual installation of some dependencies if not already present on the target machine.

   [Find downloads and installation instructions here](./README.md).

   **_Only choose this option if you have the necessary skills to configure the operating system firewall yourself._**