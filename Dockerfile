FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build-env
WORKDIR /app

# Install Node.js 20 for the Vite build
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Cache npm deps
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Cache NuGet deps
COPY *.csproj nuget.config ./
RUN dotnet restore

# Copy the rest of the source and build the SPA + backend
COPY . ./
RUN npm run build
RUN dotnet publish -c Release -o /publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app

# Route Viewer P0: NTLM auth libs for SSRS proxy (P11 Report module).
# libgssapi-krb5-2 provides the GSSAPI implementation; gss-ntlmssp is
# the NTLM security provider. Without both, .NET's HttpClient falls
# back to Kerberos-only and every SSRS request 401s against on-prem
# Reporting Services.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgssapi-krb5-2 gss-ntlmssp \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build-env /publish ./

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "RoutedOperations.dll"]
