using System.ComponentModel;

namespace RunBuilder.Models
{
    public enum Country
    {
        [Description("NZ")] Nz = 1,
        [Description("US")] Us = 2
    }

    public static class CountryExtensions
    {
        public static string GetDescription(this Country country)
        {
            var fieldInfo = country.GetType().GetField(country.ToString());
            var descriptionAttributes =
                (DescriptionAttribute[])fieldInfo?.GetCustomAttributes(typeof(DescriptionAttribute), false);

            return descriptionAttributes?.Length > 0 ? descriptionAttributes[0].Description : country.ToString();
        }
    }

}
