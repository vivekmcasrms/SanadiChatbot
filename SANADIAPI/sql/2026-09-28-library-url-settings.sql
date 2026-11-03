-- Keep existing credential selection and multi-catalogue routing unchanged.
-- Add only the catalogue URL template to the existing result.
CREATE OR ALTER PROCEDURE dbo.usp_Library_GetOclcSettings
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        provider_name AS ProviderName, CAST(enabled AS bit) AS Enabled,
        base_url AS BaseUrl, catalogue_url_template AS CatalogueUrlTemplate,
        library_client_id AS ClientId, library_client_secret AS ClientSecret
    FROM dbo.library_provider_settings
    WHERE enabled = 1
      AND NULLIF(LTRIM(RTRIM(library_client_id)), N'') IS NOT NULL
      AND NULLIF(LTRIM(RTRIM(library_client_secret)), N'') IS NOT NULL
    ORDER BY CASE WHEN provider_key = N'library_search' THEN 0 ELSE 1 END, provider_name;
END;
GO
