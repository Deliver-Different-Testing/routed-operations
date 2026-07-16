FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build-env
WORKDIR /app

# Install Node.js 20 for the Vite build
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Cache npm deps
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Cache NuGet deps
COPY *.csproj ./
RUN dotnet restore

# Copy the rest of the source and build the SPA + backend
COPY . ./
RUN npm run build
RUN dotnet publish -c Release -o /publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build-env /publish ./

EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "RoutedOperations.dll"]
