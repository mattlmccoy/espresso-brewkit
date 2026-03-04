# espresso-extraction-py

## **Espresso Extraction Analysis**
### *A Metrology-Driven Approach to Perfecting Espresso Shots* ☕  

This repository contains Python scripts designed to **collect, analyze, and visualize espresso extraction data**. The project leverages metrology principles to study the effects of **temperature and grind size** on **extraction yield**, demonstrating how precise measurements impact coffee quality.  

---

## **🎥 Video**
A video was created to better explain and show the results from these studies and what can be done with the script.  
https://www.youtube.com/watch?v=FDcUICSV3XE

---


## **📜 Features**

### **Data Collection**
- Interactive data input with **smart defaults** and **validation**
- Automatically calculates **Total Dissolved Solids (TDS)** and **extraction yield**
- Real-time feedback on calculated values
- Saves data in structured CSV format under `extraction_data/`
- Input validation to prevent errors

### **2D Data Visualization**
- Plots **extraction yield vs. various parameters**
- **Linear regression** with trend line visualization
- **Statistical metrics**: R² (coefficient of determination) and RMSE (root mean squared error)
- Enhanced plot styling with better readability
- High-resolution figure export (600 DPI)

### **3D Data Visualization**
- Plots **extraction yield vs. two selected parameters**
- **Multiple linear regression** to fit a trend plane
- **Statistical metrics**: R² and RMSE for plane fit quality
- Interactive 3D visualization with optimized viewing angle
- **Real data points (red)** and **interpolated trend points (light blue)**

### **New in v2.0**
- **Command-line interface** with argparse support
- **Configuration file** (`config.json`) for customizable defaults
- **Type hints** throughout the codebase for better IDE support
- **Comprehensive error handling** and input validation
- **Enhanced documentation** with detailed docstrings
- **Modern Python packaging** with `setup.py` and `requirements.txt`
- **Statistical analysis** with R² and RMSE calculations
- **Improved user experience** with better formatting and feedback

---

## **📥 Installation**

### **Requirements**
- **Python 3.8+** (recommended: Python 3.10 or higher)
- pip package manager

### **Quick Install**
```bash
# Clone the repository
git clone https://github.com/mattlmccoy/espresso-extraction-py.git
cd espresso-extraction-py

# Install dependencies
pip install -r requirements.txt

# Or install as a package
pip install -e .
```

### **Dependencies**
- `numpy` >= 1.24.0 - Numerical computing
- `pandas` >= 2.0.0 - Data manipulation
- `matplotlib` >= 3.7.0 - Visualization
- `scipy` >= 1.10.0 - Scientific computing
- `scikit-learn` >= 1.3.0 - Statistical metrics

---

## **🚀 Usage**

### **Interactive Mode**
Run the script without arguments to use the interactive menu:

```bash
python espresso_extraction.py
```

### **Command-Line Interface**
Use command-line arguments for quick access to specific features:

```bash
# Collect data directly
python espresso_extraction.py --collect

# Create 2D visualization
python espresso_extraction.py --plot-2d

# Create 3D visualization
python espresso_extraction.py --plot-3d

# Use custom data directory
python espresso_extraction.py --data-dir /path/to/data --plot-2d

# Show help
python espresso_extraction.py --help
```

### **Menu Options**
1. **Collect Data** → Input experimental parameters and save data
2. **Visualize 2D Plot** → Select a variable and plot extraction yield with regression
3. **Visualize 3D Plot** → Generate a 3D regression plane for deeper analysis
4. **Exit** → Close the program

### **Configuration**
Customize default values by editing `config.json`:

```json
{
  "defaults": {
    "temperature_celsius": 93,
    "pressure_bar": 9,
    "grind_size": "medium",
    "extraction_time_seconds": 25
  },
  "grind_size_mapping": {
    "fine": 200,
    "medium": 400,
    "coarse": 600
  },
  "brix_to_tds_factor": 0.85
}
```  

---

## **📊 Example Outputs**
### **2D Plot: Temperature vs. Extraction Yield**
- Shows a linear trend between extraction temperature and yield.
  
![image](https://github.com/user-attachments/assets/731ea67e-6e43-4f65-8791-f3ab49eaf81f)

### **3D Plot: Temperature & Grind Size vs. Extraction Yield**
- Fitted **least squares regression plane** highlights data trends.
- **Red points** = real data, **light blue points** = interpolated.

![extraction_3D_Temperature_90-95_Grind_200-600_20250312_233608](https://github.com/user-attachments/assets/f7f11192-1e68-4d54-9692-a46c6f8eeddb)

---

## **📖 Scientific Basis**
This project applies **metrology principles** to espresso brewing, emphasizing the **importance of precise measurement** in achieving a **consistent and high-quality shot**.  

**Reference List:**

[1] Várady, M., Tauchen, J., Klouček, P., & Popelka, P. (2022). Effects of Total Dissolved Solids, Extraction Yield, Grinding, and Method of Preparation on Antioxidant Activity in Fermented Specialty Coffee. Fermentation, 8(8), 375. https://doi.org/10.3390/fermentation8080375

[2] Andueza, S.F., Vila, M.A., Peña, M.P., & Cid, C. (2007). Influence of coffee/water ratio on the final quality of espresso coffee. Journal of the Science of Food and Agriculture, 87, 586-592. https://doi.org/10.1002/jsfa.2720

[3] Batali, M. E., Cotter, A. R., Frost, S. C., Ristenpart, W. D., & Guinard, J.-X. (2021). Titratable Acidity, Perceived Sourness, and Liking of Acidity in Drip Brewed Coffee. ACS Food Science & Technology, 1(4), 559–569. https://doi.org/10.1021/acsfoodscitech.0c00078

[4] Klotz, J. A., Winkler, G., & Lachenmeier, D. W. (2020). Influence of the Brewing Temperature on the Taste of Espresso. Foods (Basel, Switzerland), 9(1), 36. https://doi.org/10.3390/foods9010036

[5] Andueza, S., De Peña, M. P., & Cid, C. (2003). Chemical and sensorial characteristics of espresso coffee as affected by grinding and torrefacto roast. Journal of Agricultural and Food Chemistry, 51(24), 7034–7039. https://doi.org/10.1021/jf034628f

[6] Liu, X., Tang, Y., & Wang, Y. (2022). Consumer Satisfaction for Starbucks. Proceedings of the 2022 7th International Conference on Social Sciences and Economic Development (ICSSED 2022), 1475–1482. https://doi.org/10.2991/aebmr.k.220405.247

---

## **📂 Repository Structure**
```
espresso-extraction-py/
├── espresso_extraction.py  # Main script with data collection & visualization
├── config.json             # Configuration file for defaults
├── requirements.txt        # Python dependencies
├── setup.py                # Package setup configuration
├── .gitignore              # Git ignore rules
├── README.md               # This document
├── sample-data/            # Example collected data (CSV files)
│   └── figures/            # Saved visualization plots
└── extraction_data/        # User-generated data (created at runtime)
    └── figures/            # User-generated plots
```

## **🆕 What's New in v2.0**

### **Code Quality Improvements**
- ✅ Added comprehensive **type hints** for better IDE support
- ✅ Improved **docstrings** with detailed parameter descriptions
- ✅ Enhanced **error handling** with try-except blocks
- ✅ Removed **unused imports** (scipy.interpolate.griddata)
- ✅ Fixed **CSV header order** to match data collection sequence

### **Feature Enhancements**
- ✅ **Command-line arguments** support (--collect, --plot-2d, --plot-3d)
- ✅ **Configuration file** (config.json) for customizable defaults
- ✅ **Input validation** with positive value checks and range validation
- ✅ **Statistical metrics**: R² and RMSE displayed on all plots
- ✅ **Better visualization** with improved colors, labels, and layout
- ✅ **User feedback** showing calculated TDS and extraction yield

### **Developer Experience**
- ✅ Modern **packaging** with setup.py and requirements.txt
- ✅ Comprehensive **.gitignore** for Python projects
- ✅ **Structured configuration** with JSON support
- ✅ **Better error messages** and user guidance
- ✅ **Keyboard interrupt handling** for graceful exits

---

## **🔬 Equipment**

Cheap refractometer: https://a.co/d/f6HQd3G
--> Measures in Brix (sugar content). The script converts **Brix** to **TDS** and **Extraction Yield**.

---

## **📌 Acknowledgments**
This project was developed as part of a **metrology education initiative**, illustrating how precision measurement impacts everyday experiences like making coffee. ☕🔬  

This work was created for the course ME 6225: Metrology at Georgia Institute of Technology in the George W. Woodruff School of Mechanical Engineering.
