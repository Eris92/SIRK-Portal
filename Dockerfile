FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY global.json Directory.Build.props release-trusted-keys.json ./
COPY public public
COPY src/Sirk.Portal src/Sirk.Portal
RUN dotnet publish src/Sirk.Portal/Sirk.Portal.csproj \
    --configuration Release \
    --output /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080 \
    DOTNET_EnableDiagnostics=0 \
    Sirk__DataRoot=/var/lib/sirk-portal/data \
    Sirk__Central__ConnectionFile=/var/lib/sirk-portal/data/central-connection.json
EXPOSE 8080
COPY --from=build /app/publish ./
RUN mkdir -p /var/lib/sirk-portal/data \
    && chown -R "$APP_UID:$APP_UID" /var/lib/sirk-portal
VOLUME ["/var/lib/sirk-portal"]
HEALTHCHECK --interval=20s --timeout=7s --start-period=10s --retries=3 \
    CMD ["dotnet", "Sirk.Portal.dll", "--health-check", "http://127.0.0.1:8080/readyz"]
USER $APP_UID
ENTRYPOINT ["dotnet", "Sirk.Portal.dll"]
