using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Dtos.BulkImport.Address
{
    public partial class HereGeocodingResponse
    {
        [JsonProperty("items")]
        public List<GeocodingItem> Items { get; set; }
    }

    public partial class GeocodingItem
    {
        [JsonProperty("title")]
        public string Title { get; set; }

        [JsonProperty("id")]
        public string Id { get; set; }

        [JsonProperty("resultType")]
        public string ResultType { get; set; }

        [JsonProperty("houseNumberType")]
        public string HouseNumberType { get; set; }

        [JsonProperty("address")]
        public Address Address { get; set; }

        [JsonProperty("position")]
        public Position Position { get; set; }

        [JsonProperty("access")]
        public List<Position> Access { get; set; }

        [JsonProperty("mapView")]
        public MapView MapView { get; set; }

        [JsonProperty("scoring")]
        public Scoring Scoring { get; set; }
    }

    public partial class Address
    {
        [JsonProperty("label")]
        public string Label { get; set; }

        [JsonProperty("countryCode")]
        public string CountryCode { get; set; }

        [JsonProperty("countryName")]
        public string CountryName { get; set; }

        [JsonProperty("state")]
        public string State { get; set; }

        [JsonProperty("county")]
        public string County { get; set; }

        [JsonProperty("city")]
        public string City { get; set; }

        [JsonProperty("district")]
        public string District { get; set; }

        [JsonProperty("street")]
        public string Street { get; set; }

        [JsonProperty("postalCode")]
        public string PostalCode { get; set; }

        [JsonProperty("houseNumber")]
        public string HouseNumber { get; set; }
    }

    public partial class Position
    {
        [JsonProperty("lat")]
        public double Lat { get; set; }

        [JsonProperty("lng")]
        public double Lng { get; set; }
    }

    public partial class MapView
    {
        [JsonProperty("west")]
        public double West { get; set; }

        [JsonProperty("south")]
        public double South { get; set; }

        [JsonProperty("east")]
        public double East { get; set; }

        [JsonProperty("north")]
        public double North { get; set; }
    }

    public partial class Scoring
    {
        [JsonProperty("queryScore")]
        public double QueryScore { get; set; }

        [JsonProperty("fieldScore")]
        public FieldScore FieldScore { get; set; }
    }

    public partial class FieldScore
    {
        [JsonProperty("country")]
        public double? Country { get; set; }

        [JsonProperty("district")]
        public double? District { get; set; }

        [JsonProperty("streets")]
        public List<double> Streets { get; set; }

        [JsonProperty("houseNumber")]
        public double? HouseNumber { get; set; }

        [JsonProperty("postalCode")]
        public double? PostalCode { get; set; }
    }
}
